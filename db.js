/**
 * Storage for Aria AI Recruiter.
 *
 * Two drivers, same interface:
 *  - Postgres when DATABASE_URL is set (e.g. a free Neon database) -
 *    data survives restarts AND redeploys.
 *  - A local JSON file otherwise (aria-data.json) - fine for development
 *    and demos; on hosts with an ephemeral filesystem it resets on
 *    redeploy.
 *
 * All state is cached in memory after boot and written through on every
 * change, so app code behaves identically on both drivers.
 */

import { promises as fs } from 'fs';
import path from 'path';

const DATA_FILE = process.env.DATA_FILE || path.join(process.cwd(), 'aria-data.json');
const DATABASE_URL = (process.env.DATABASE_URL || '').trim();

let state = {
  candidates: [],
  screenings: [],
  owner: null,      // { email, passwordHash, createdAt }
  sessions: {},     // token -> { email, createdAt, expiresAt }
};

let pool = null;
const driver = DATABASE_URL ? 'postgres' : 'file';
export const storageDriver = driver;

/* ---------- low-level persistence ---------- */

let fileWriteQueue = Promise.resolve();

async function persistFile() {
  if (driver !== 'file') return;
  const snapshot = JSON.stringify(state, null, 2);
  fileWriteQueue = fileWriteQueue.then(async () => {
    const tmp = `${DATA_FILE}.tmp`;
    await fs.writeFile(tmp, snapshot, 'utf8');
    await fs.rename(tmp, DATA_FILE);
  });
  return fileWriteQueue;
}

async function pgQuery(text, params) {
  const { default: pg } = await import('pg');
  if (!pool) {
    pool = new pg.Pool({
      connectionString: DATABASE_URL,
      max: 3,
      ssl: DATABASE_URL.includes('sslmode=disable') ? false : { rejectUnauthorized: false },
    });
  }
  return pool.query(text, params);
}

async function pgSetup() {
  await pgQuery(`CREATE TABLE IF NOT EXISTS candidates (id text PRIMARY KEY, data jsonb NOT NULL)`);
  await pgQuery(`CREATE TABLE IF NOT EXISTS screenings (id text PRIMARY KEY, data jsonb NOT NULL)`);
  await pgQuery(`CREATE TABLE IF NOT EXISTS meta (id text PRIMARY KEY, data jsonb NOT NULL)`);
}

async function pgUpsert(table, id, data) {
  await pgQuery(
    `INSERT INTO ${table} (id, data) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET data = $2`,
    [id, JSON.stringify(data)]
  );
}

async function pgDelete(table, id) {
  await pgQuery(`DELETE FROM ${table} WHERE id = $1`, [id]);
}

async function persistMeta() {
  if (driver === 'file') return persistFile();
  await pgUpsert('meta', 'auth', { owner: state.owner, sessions: state.sessions });
}

/* ---------- boot ---------- */

export async function loadStore() {
  if (driver === 'postgres') {
    await pgSetup();
    const [cands, scr, meta] = await Promise.all([
      pgQuery('SELECT data FROM candidates'),
      pgQuery('SELECT data FROM screenings'),
      pgQuery(`SELECT data FROM meta WHERE id = 'auth'`),
    ]);
    state.candidates = cands.rows.map((r) => r.data);
    state.screenings = scr.rows.map((r) => r.data);
    if (meta.rows[0]) {
      state.owner = meta.rows[0].data.owner || null;
      state.sessions = meta.rows[0].data.sessions || {};
    }
    console.log(`💾 Postgres store: ${state.candidates.length} candidates, ${state.screenings.length} screenings`);
    return;
  }
  try {
    const raw = await fs.readFile(DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    state = {
      candidates: Array.isArray(parsed.candidates) ? parsed.candidates : [],
      screenings: Array.isArray(parsed.screenings) ? parsed.screenings : [],
      owner: parsed.owner || null,
      sessions: parsed.sessions || {},
    };
    console.log(`💾 File store (${DATA_FILE}): ${state.candidates.length} candidates, ${state.screenings.length} screenings`);
  } catch (err) {
    if (err.code !== 'ENOENT') console.error('⚠️  Could not read data file, starting empty:', err.message);
  }
}

/* ---------- candidates ---------- */

export const getCandidates = () => state.candidates;

export async function upsertCandidate(candidate) {
  const idx = state.candidates.findIndex((c) => c.id === candidate.id);
  if (idx >= 0) state.candidates[idx] = { ...state.candidates[idx], ...candidate };
  else state.candidates.push(candidate);
  const saved = idx >= 0 ? state.candidates[idx] : candidate;
  if (driver === 'file') await persistFile();
  else await pgUpsert('candidates', saved.id, saved);
  return saved;
}

export async function removeCandidate(id) {
  const before = state.candidates.length;
  state.candidates = state.candidates.filter((c) => c.id !== id);
  if (state.candidates.length === before) return false;
  if (driver === 'file') await persistFile();
  else await pgDelete('candidates', id);
  return true;
}

export function findCandidateByCallId(callId) {
  return state.candidates.find((c) => c.callId === callId);
}

/* ---------- screenings (immutable published results + pending review) ---------- */

export const getScreenings = () => state.screenings;

const CONTENT_KEYS = [
  'candidateName', 'phoneNumber', 'roleApplied', 'overallScore', 'recommendation',
  'notes', 'roleCategory', 'strengths', 'risks', 'transcript', 'demo',
];

function sameContent(a, b) {
  for (const key of CONTENT_KEYS) {
    if (String(a[key] ?? '') !== String(b[key] ?? '')) return false;
  }
  return (
    JSON.stringify(a.answers || {}) === JSON.stringify(b.answers || {}) &&
    JSON.stringify(a.questionScores || {}) === JSON.stringify(b.questionScores || {})
  );
}

/**
 * Save a screening result. A result that already exists (same id or
 * callId) is NEVER silently overwritten: an identical payload is a
 * no-op (webhook replay safe), and a changed payload is stored as a
 * pendingUpdate that a human reviewer must approve before it replaces
 * the published result.
 */
export async function saveScreening(result) {
  const idx = state.screenings.findIndex(
    (item) => item.id === result.id || (result.callId && item.callId === result.callId)
  );

  if (idx >= 0) {
    const existing = state.screenings[idx];
    if (sameContent(existing, result)) {
      return { record: existing, changed: false, pendingReview: false };
    }
    result.id = existing.id;
    // Strip reviewer-owned fields from the incoming payload
    delete result.decision;
    delete result.decidedAt;
    delete result.pendingUpdate;
    existing.pendingUpdate = result;
    if (driver === 'file') await persistFile();
    else await pgUpsert('screenings', existing.id, existing);
    return { record: existing, changed: true, pendingReview: true };
  }

  result.decision = 'pending';
  result.decidedAt = null;
  state.screenings.push(result);
  if (driver === 'file') await persistFile();
  else await pgUpsert('screenings', result.id, result);
  return { record: result, changed: true, pendingReview: false };
}

export async function removeScreening(id) {
  const before = state.screenings.length;
  state.screenings = state.screenings.filter((r) => r.id !== id);
  if (state.screenings.length === before) return false;
  if (driver === 'file') await persistFile();
  else await pgDelete('screenings', id);
  return true;
}

const VALID_DECISIONS = new Set(['pending', 'shortlisted', 'rejected']);

export async function setScreeningDecision(id, decision) {
  if (!VALID_DECISIONS.has(decision)) return null;
  const result = state.screenings.find((r) => r.id === id);
  if (!result) return undefined;
  result.decision = decision;
  result.decidedAt = decision === 'pending' ? null : new Date().toISOString();
  if (driver === 'file') await persistFile();
  else await pgUpsert('screenings', result.id, result);
  return result;
}

/**
 * Apply the human review of a pending update.
 *  approve -> the pending payload becomes the published result and the
 *             decision resets to pending (the reviewer decides again on
 *             the new content).
 *  dismiss -> the pending payload is dropped; the published result and
 *             its decision stay untouched.
 */
export async function reviewScreeningUpdate(id, action) {
  const result = state.screenings.find((r) => r.id === id);
  if (!result) return undefined;
  if (!result.pendingUpdate) return null;
  if (action === 'approve') {
    const next = result.pendingUpdate;
    next.decision = 'pending';
    next.decidedAt = null;
    const pos = state.screenings.indexOf(result);
    state.screenings[pos] = next;
    if (driver === 'file') await persistFile();
    else await pgUpsert('screenings', next.id, next);
    return next;
  }
  if (action === 'dismiss') {
    delete result.pendingUpdate;
    if (driver === 'file') await persistFile();
    else await pgUpsert('screenings', result.id, result);
    return result;
  }
  return null;
}

/* ---------- owner auth + sessions ---------- */

export const getOwner = () => (state.owner ? { email: state.owner.email } : null);
export const getOwnerSecret = () => state.owner;

export async function saveOwner(owner) {
  if (state.owner) return false;
  state.owner = owner;
  await persistMeta();
  return true;
}

export function getSession(token) {
  const session = state.sessions[token];
  if (!session) return null;
  if (new Date(session.expiresAt).getTime() < Date.now()) {
    delete state.sessions[token];
    persistMeta();
    return null;
  }
  return session;
}

export async function saveSession(token, session) {
  state.sessions[token] = session;
  // Prune expired sessions while we are here
  const now = Date.now();
  for (const [key, value] of Object.entries(state.sessions)) {
    if (new Date(value.expiresAt).getTime() < now) delete state.sessions[key];
  }
  await persistMeta();
}

export async function dropSession(token) {
  if (!state.sessions[token]) return;
  delete state.sessions[token];
  await persistMeta();
}
