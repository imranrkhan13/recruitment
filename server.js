/**
 * Backend Server for Aria AI Recruiter
 * Handles Bolna API calls, webhooks, and screening data management.
 *
 * - All /api routes except login/setup and the webhook require the
 *   owner's session cookie. Candidate data and decisions are private.
 * - The webhook is fail-closed: it only accepts posts carrying the
 *   WEBHOOK_TOKEN shared secret, and is disabled while that is unset.
 * - Real outbound calls require ALLOW_REAL_CALLS=true explicitly.
 * - Screening results are immutable once published: a changed payload
 *   for an existing result becomes a pending update a human reviews.
 *
 * Run with: node server.js
 * Serves the built frontend from ./dist when present, so the whole app
 * works from one URL.
 */

import express from 'express';
import cors from 'cors';
import axios from 'axios';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import {
  loadStore,
  storageDriver,
  getCandidates,
  getScreenings,
  upsertCandidate,
  removeCandidate,
  findCandidateByCallId,
  saveScreening,
  removeScreening,
  setScreeningDecision,
  reviewScreeningUpdate,
  getOwner,
  getOwnerSecret,
  saveOwner,
  getSession,
  saveSession,
  dropSession,
} from './db.js';

dotenv.config();
dotenv.config({ path: '.env.local' });

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

/* ================= auth helpers ================= */

const SESSION_COOKIE = 'aria_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

const hashPassword = (password) => {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt:${salt}:${hash}`;
};

const verifyPassword = (password, stored) => {
  try {
    const [, salt, hash] = String(stored).split(':');
    const candidate = crypto.scryptSync(password, salt, 64);
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), candidate);
  } catch {
    return false;
  }
};

const parseCookies = (req) => {
  const header = req.headers.cookie || '';
  const cookies = {};
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name) cookies[name] = decodeURIComponent(rest.join('='));
  }
  return cookies;
};

const setSessionCookie = (req, res, token) => {
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.cookie
    ? res.cookie(SESSION_COOKIE, token, {
        httpOnly: true,
        sameSite: 'lax',
        secure,
        maxAge: SESSION_TTL_MS,
        path: '/',
      })
    : res.setHeader(
        'Set-Cookie',
        `${SESSION_COOKIE}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}${secure ? '; Secure' : ''}`
      );
};

const clearSessionCookie = (res) => {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`);
};

const sessionFromRequest = (req) => {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token) return null;
  const session = getSession(token);
  return session ? { token, ...session } : null;
};

// Simple per-IP login throttling: 5 failures -> 15 minute cooldown.
const loginAttempts = new Map(); // ip -> { fails, lockedUntil }
const loginThrottled = (ip) => {
  const entry = loginAttempts.get(ip);
  return entry?.lockedUntil && entry.lockedUntil > Date.now();
};
const recordLoginFailure = (ip) => {
  const entry = loginAttempts.get(ip) || { fails: 0, lockedUntil: 0 };
  entry.fails += 1;
  if (entry.fails >= 5) {
    entry.lockedUntil = Date.now() + 15 * 60 * 1000;
    entry.fails = 0;
  }
  loginAttempts.set(ip, entry);
};
const clearLoginFailures = (ip) => loginAttempts.delete(ip);

const requireAuth = (req, res, next) => {
  if (sessionFromRequest(req)) return next();
  return res.status(401).json({ error: 'Sign in required' });
};

/* ================= auth endpoints ================= */

app.get('/api/auth/me', (req, res) => {
  const owner = getOwner();
  const session = sessionFromRequest(req);
  res.json({
    setupRequired: !owner,
    authenticated: Boolean(session),
    email: session?.email || null,
  });
});

app.post('/api/auth/setup', async (req, res) => {
  try {
    if (getOwner()) {
      return res.status(409).json({ error: 'Owner account already exists. Sign in instead.' });
    }
    // First-run setup is locked behind a private bootstrap secret so a
    // stranger who finds the public URL before the owner cannot claim
    // the workspace. Without BOOTSTRAP_SECRET configured, setup stays
    // closed entirely (fail-closed).
    if (!process.env.BOOTSTRAP_SECRET) {
      return res.status(503).json({ error: 'Setup is locked on this server. The owner must configure BOOTSTRAP_SECRET first.' });
    }
    const provided = String(req.body?.bootstrapSecret || '');
    const expected = process.env.BOOTSTRAP_SECRET;
    const providedBuf = Buffer.from(provided);
    const expectedBuf = Buffer.from(expected);
    if (providedBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(providedBuf, expectedBuf)) {
      return res.status(401).json({ error: 'Incorrect setup code.' });
    }
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return res.status(400).json({ error: 'Enter a valid email address.' });
    }
    if (password.length < 12) {
      return res.status(400).json({ error: 'Password must be at least 12 characters.' });
    }
    await saveOwner({ email, passwordHash: hashPassword(password), createdAt: new Date().toISOString() });
    const token = crypto.randomBytes(32).toString('hex');
    await saveSession(token, { email, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString() });
    setSessionCookie(req, res, token);
    res.json({ success: true, email });
  } catch (error) {
    console.error('❌ Setup error:', error);
    res.status(500).json({ error: 'Setup failed', details: error.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const ip = req.ip || 'unknown';
  if (loginThrottled(ip)) {
    return res.status(429).json({ error: 'Too many failed attempts. Try again in about 15 minutes.' });
  }
  const owner = getOwnerSecret();
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  if (!owner || owner.email !== email || !verifyPassword(password, owner.passwordHash)) {
    recordLoginFailure(ip);
    return res.status(401).json({ error: 'Incorrect email or password.' });
  }
  clearLoginFailures(ip);
  const token = crypto.randomBytes(32).toString('hex');
  await saveSession(token, { email, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString() });
  setSessionCookie(req, res, token);
  res.json({ success: true, email });
});

app.post('/api/auth/logout', async (req, res) => {
  const session = sessionFromRequest(req);
  if (session) await dropSession(session.token);
  clearSessionCookie(res);
  res.json({ success: true });
});

// Everything below under /api requires sign-in, except the webhook
// (protected by its own shared secret instead).
app.use('/api', (req, res, next) => {
  if (req.path === '/webhook/screening-complete') return next();
  return requireAuth(req, res, next);
});

/* ================= Bolna configuration ================= */

const BOLNA_API_KEY = (process.env.BOLNA_API_KEY || process.env.VITE_BOLNA_API_KEY || '').trim();
const BOLNA_AGENT_ID = (process.env.BOLNA_AGENT_ID || process.env.VITE_BOLNA_AGENT_ID || '').trim();
// Real outbound calls cost money and ring real phones. They stay OFF
// unless ALLOW_REAL_CALLS=true is set explicitly, even when Bolna
// credentials are present. Without that flag every call is a local demo.
const REAL_CALLS_ALLOWED = process.env.ALLOW_REAL_CALLS === 'true';
const HAS_BOLNA_CREDS = Boolean(BOLNA_API_KEY && BOLNA_AGENT_ID);
const MOCK_CALLS = process.env.MOCK_BOLNA_CALLS === 'true' || !REAL_CALLS_ALLOWED || !HAS_BOLNA_CREDS;
// Even with real calls enabled, only numbers on this explicit E.164
// allowlist (REAL_CALL_ALLOWLIST, comma-separated) can be dialed. An
// empty list means no real call can be placed.
const REAL_CALL_ALLOWLIST = (process.env.REAL_CALL_ALLOWLIST || '')
  .split(',').map((n) => n.trim()).filter(Boolean);
const BOLNA_API_BASE = 'https://api.bolna.ai';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const normalizePhoneNumber = (phoneNumber) => {
  const trimmed = String(phoneNumber || '').trim();
  if (trimmed.startsWith('+')) return trimmed;

  const digits = trimmed.replace(/\D/g, '');
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length > 10) return `+${digits}`;
  return trimmed;
};

const normalizeRecommendation = (value, score) => {
  const normalized = String(value || '').toUpperCase();
  if (normalized === 'PASS' || normalized === 'REJECT') return normalized;
  return Number(score) >= 70 ? 'PASS' : 'REJECT';
};

const getExtractedValue = (data, keys) => {
  if (!data || typeof data !== 'object') return '';
  const normalizedKeys = keys.map((key) => key.toLowerCase().replace(/[^a-z0-9]/g, ''));

  const visit = (value, parentKey = '') => {
    if (!value || typeof value !== 'object') return '';

    if ('subjective' in value || 'objective' in value) {
      return value.subjective || value.objective || '';
    }

    for (const [key, child] of Object.entries(value)) {
      const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, '');
      const combinedKey = `${parentKey}${normalizedKey}`;
      const keyMatches = normalizedKeys.some(
        (item) => normalizedKey.includes(item) || combinedKey.includes(item)
      );

      if (keyMatches) {
        if (child && typeof child === 'object') {
          const nested = visit(child, combinedKey);
          if (nested) return nested;
        }
        return child;
      }

      const nested = visit(child, combinedKey);
      if (nested) return nested;
    }

    return '';
  };

  return visit(data);
};

const makeDemoResult = ({ candidateId, candidateName, phoneNumber, roleApplied, callId }) => {
  const score = 76 + Math.floor(Math.random() * 12);

  return {
    id: `screening_${Date.now()}`,
    candidateId,
    candidateName,
    phoneNumber,
    roleApplied,
    overallScore: score,
    recommendation: normalizeRecommendation(null, score),
    demo: true,
    notes: 'Sample screening result generated locally. No real call was placed and no one was contacted.',
    roleCategory: 'role-specific',
    strengths: 'Sample data: clear communication, relevant experience, and practical role understanding.',
    risks: 'Sample data only. A real Bolna call is needed for true candidate signals.',
    questionScores: {
      q1: 80,
      q2: 78,
      q3: score,
      q4: 82,
      q5: 76,
    },
    answers: {
      q1: `${candidateName} described relevant recent work and communicated clearly. (sample answer)`,
      q2: `They expressed interest in the ${roleApplied} role and the team's problem space. (sample answer)`,
      q3: `They answered a practical ${roleApplied} scenario with role-aligned skills and examples. (sample answer)`,
      q4: 'They are available within a reasonable notice period. (sample answer)',
      q5: 'Salary expectations were within a negotiable range. (sample answer)',
    },
    callId,
    receivedAt: new Date(),
  };
};

const buildScreeningResult = (screeningData) => {
  const extractedData = screeningData.extracted_data || screeningData.extractedData || {};
  const extractedScore = getExtractedValue(extractedData, ['overall_score', 'overall score', 'score']);
  const overallScore = Number(
    extractedScore || screeningData.overall_score || screeningData.overallScore || screeningData.score || 0
  );

  return {
    id: screeningData.id || `screening_${Date.now()}`,
    candidateId:
      getExtractedValue(extractedData, ['candidate_id', 'candidate id']) ||
      screeningData.candidate_id ||
      screeningData.candidateId ||
      '',
    candidateName:
      getExtractedValue(extractedData, ['candidate_name', 'candidate name']) ||
      screeningData.candidate_name ||
      screeningData.candidateName ||
      'Unknown',
    phoneNumber:
      getExtractedValue(extractedData, ['phone_number', 'phone number']) ||
      screeningData.phone_number ||
      screeningData.phoneNumber ||
      '',
    roleApplied:
      getExtractedValue(extractedData, ['role_applied', 'role applied', 'role']) ||
      screeningData.role_applied ||
      screeningData.roleApplied ||
      '',
    overallScore,
    recommendation: normalizeRecommendation(
      getExtractedValue(extractedData, ['recommendation', 'decision', 'outcome']) || screeningData.recommendation,
      overallScore
    ),
    demo: Boolean(screeningData.demo),
    notes:
      getExtractedValue(extractedData, ['notes', 'summary', 'hr summary']) ||
      screeningData.notes ||
      screeningData.summary ||
      screeningData.transcript ||
      '',
    roleCategory:
      getExtractedValue(extractedData, ['role_category', 'role category', 'field']) ||
      screeningData.role_category ||
      screeningData.roleCategory ||
      '',
    strengths:
      getExtractedValue(extractedData, ['strengths', 'positive signals']) ||
      screeningData.strengths ||
      '',
    risks:
      getExtractedValue(extractedData, ['risks', 'red flags', 'concerns']) ||
      screeningData.risks ||
      '',
    questionScores: {
      q1: Number(getExtractedValue(extractedData, ['score_q1', 'q1 score']) || screeningData.score_q1 || screeningData.questionScores?.q1 || 0),
      q2: Number(getExtractedValue(extractedData, ['score_q2', 'q2 score']) || screeningData.score_q2 || screeningData.questionScores?.q2 || 0),
      q3: Number(getExtractedValue(extractedData, ['score_q3', 'q3 score']) || screeningData.score_q3 || screeningData.questionScores?.q3 || 0),
      q4: Number(getExtractedValue(extractedData, ['score_q4', 'q4 score']) || screeningData.score_q4 || screeningData.questionScores?.q4 || 0),
      q5: Number(getExtractedValue(extractedData, ['score_q5', 'q5 score']) || screeningData.score_q5 || screeningData.questionScores?.q5 || 0),
    },
    answers: {
      q1: getExtractedValue(extractedData, ['answer_q1', 'background']) || screeningData.answer_q1 || screeningData.answers?.q1 || '',
      q2: getExtractedValue(extractedData, ['answer_q2', 'interest', 'motivation']) || screeningData.answer_q2 || screeningData.answers?.q2 || '',
      q3: getExtractedValue(extractedData, ['answer_q3', 'role specific', 'technical', 'sales', 'experience', 'skills']) || screeningData.answer_q3 || screeningData.answers?.q3 || '',
      q4: getExtractedValue(extractedData, ['answer_q4', 'availability', 'notice']) || screeningData.answer_q4 || screeningData.answers?.q4 || '',
      q5: getExtractedValue(extractedData, ['answer_q5', 'salary', 'compensation']) || screeningData.answer_q5 || screeningData.answers?.q5 || '',
    },
    transcript: screeningData.transcript || '',
    callId: screeningData.execution_id || screeningData.call_id || screeningData.callId || screeningData.id || '',
    receivedAt: screeningData.receivedAt ? new Date(screeningData.receivedAt) : new Date(),
  };
};

const saveScreeningResult = (screeningData) => saveScreening(buildScreeningResult(screeningData));

const syncCompletedExecution = async (callId) => {
  if (MOCK_CALLS || !HAS_BOLNA_CREDS) return null;

  let response;
  try {
    response = await axios.get(
      `${BOLNA_API_BASE}/agent/${BOLNA_AGENT_ID}/execution/${callId}`,
      {
        headers: {
          Authorization: `Bearer ${BOLNA_API_KEY}`,
        },
      }
    );
  } catch {
    response = await axios.get(
      `${BOLNA_API_BASE}/executions/${callId}`,
      {
        headers: {
          Authorization: `Bearer ${BOLNA_API_KEY}`,
        },
      }
    );
  }

  const execution = response.data;
  const completedStatuses = new Set(['completed', 'call-disconnected']);

  if (!completedStatuses.has(execution.status)) {
    return execution;
  }

  const candidate = findCandidateByCallId(callId);
  const { record } = await saveScreeningResult({
    id: `screening_${callId}`,
    execution_id: callId,
    candidate_id: candidate?.id,
    candidate_name: candidate?.name,
    phone_number: candidate?.phone,
    role_applied: candidate?.role,
    status: execution.status,
    transcript: execution.transcript,
    extracted_data: execution.extracted_data,
    receivedAt: execution.updated_at,
  });

  return { ...execution, savedResultId: record.id };
};

/* ================= candidates ================= */

/**
 * GET /api/candidates
 * List all candidates stored on the server.
 */
app.get('/api/candidates', (req, res) => {
  res.json({ total: getCandidates().length, candidates: getCandidates() });
});

/**
 * POST /api/candidates
 * Add a candidate, or update in place when the id already exists
 * (this makes browser localStorage imports safe to repeat).
 */
app.post('/api/candidates', async (req, res) => {
  try {
    const { id, name, email, phone, role, company } = req.body || {};
    if (!name || !phone) {
      return res.status(400).json({ error: 'Name and phone number are required' });
    }
    const existing = id ? getCandidates().find((c) => c.id === id) : null;
    const keep = (incoming, current) => {
      const value = String(incoming ?? '').trim();
      return value || (current || '');
    };
    const candidate = await upsertCandidate({
      id: id || crypto.randomUUID(),
      name: String(name).trim(),
      email: keep(email, existing?.email),
      phone: normalizePhoneNumber(phone),
      role: keep(role, existing?.role),
      company: keep(company, existing?.company),
      createdAt: existing?.createdAt || new Date().toISOString(),
      // Keep call tracking fields on update; only set when provided.
      ...(existing
        ? { callId: existing.callId, callStatus: existing.callStatus, callInitiatedAt: existing.callInitiatedAt }
        : {}),
    });
    res.status(existing ? 200 : 201).json({ success: true, candidate });
  } catch (error) {
    console.error('❌ Error saving candidate:', error);
    res.status(500).json({ error: 'Failed to save candidate', details: error.message });
  }
});

/**
 * PATCH /api/candidates/:id
 * Partial update (call status, notes, etc).
 */
app.patch('/api/candidates/:id', async (req, res) => {
  const candidate = getCandidates().find((c) => c.id === req.params.id);
  if (!candidate) return res.status(404).json({ error: 'Candidate not found' });
  const updates = req.body || {};
  delete updates.id;
  delete updates.createdAt;
  const updated = await upsertCandidate({ ...candidate, ...updates });
  res.json({ success: true, candidate: updated });
});

/**
 * DELETE /api/candidates/:id
 * Remove a candidate. Screening results are kept as records.
 */
app.delete('/api/candidates/:id', async (req, res) => {
  const removed = await removeCandidate(req.params.id);
  if (!removed) return res.status(404).json({ error: 'Candidate not found' });
  res.json({ success: true, message: 'Candidate removed' });
});

/* ================= calls ================= */

/**
 * POST /api/initiate-call
 * Initiates a phone screening call via Bolna, or a local demo call when
 * real calls are not explicitly enabled.
 */
app.post("/api/initiate-call", async (req, res) => {
  try {
    const { candidateId, candidateName, phoneNumber, roleApplied } = req.body;

    // Validate input
    if (!candidateName || !phoneNumber || !roleApplied) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Prepare call data for Bolna
    const callId = `call_${Date.now()}`;
    const shouldMockCall = MOCK_CALLS;
    const formattedPhoneNumber = normalizePhoneNumber(phoneNumber);

    if (!shouldMockCall && !UUID_PATTERN.test(BOLNA_AGENT_ID)) {
      return res.status(400).json({
        error: 'Bolna agent ID must be a real UUID',
        details: 'Update BOLNA_AGENT_ID in .env.local with the UUID from your Bolna dashboard. The current value looks like a placeholder.',
      });
    }

    if (!shouldMockCall && !REAL_CALL_ALLOWLIST.includes(formattedPhoneNumber)) {
      return res.status(403).json({
        error: 'Number not allowed for real calls',
        details: 'Real calls are limited to an explicit allowlist. This number is not on it, so nothing was dialed and no credits were spent.',
      });
    }

    const callPayload = {
      agent_id: BOLNA_AGENT_ID,
      recipient_phone_number: formattedPhoneNumber,
      from_phone_number: process.env.BOLNA_FROM_PHONE_NUMBER || undefined,
      user_data: {
        candidate_id: candidateId,
        candidate_name: candidateName,
        phone_number: formattedPhoneNumber,
        role: roleApplied,
        company: process.env.COMPANY_NAME || 'Your Company',
        field: roleApplied.toLowerCase(),
      },
    };

    console.log('📞 Initiating Bolna call:', callPayload);

    let callData = { call_id: callId, status: 'demo_queued' };

    if (!shouldMockCall) {
      const bolnaResponse = await axios.post(
        `${BOLNA_API_BASE}/call`,
        callPayload,
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${BOLNA_API_KEY}`,
          },
        }
      );

      callData = bolnaResponse.data;
      callData.call_id = callData.execution_id || callData.call_id || callData.id;
      console.log('✅ Call initiated successfully:', callData);
    } else {
      console.log('🧪 Demo mode enabled. Simulating a completed screening result.');
      setTimeout(() => {
        const result = makeDemoResult({
          candidateId,
          candidateName,
          phoneNumber: formattedPhoneNumber,
          roleApplied,
          callId: callData.call_id,
        });
        saveScreening(result)
          .then(({ record }) => console.log('✅ Demo screening result saved:', record.id))
          .catch((err) => console.error('❌ Failed to save demo result:', err));
      }, 2500);
    }

    // Track the call on the stored candidate
    const storedId = candidateId || callData.call_id;
    const existing = getCandidates().find((c) => c.id === storedId);
    await upsertCandidate({
      id: storedId,
      name: candidateName,
      email: existing?.email || '',
      phone: formattedPhoneNumber,
      role: roleApplied,
      company: existing?.company || '',
      createdAt: existing?.createdAt || new Date().toISOString(),
      callId: callData.call_id,
      callStatus: shouldMockCall ? 'demo_queued' : 'ringing',
      callInitiatedAt: new Date().toISOString(),
    });

    res.json({
      success: true,
      callId: callData.call_id,
      demoMode: shouldMockCall,
      message: shouldMockCall
        ? `Demo call queued for ${candidateName} - no real call was placed and no one was contacted. A sample result will appear shortly.`
        : `Call initiated for ${candidateName}. Live screening in progress...`,
    });
  } catch (error) {
    const status = error.response?.status || 500;
    const details = error.response?.data || error.response?.statusText || error.message;
    console.error('❌ Error initiating call:', status, details);
    res.status(status).json({
      error: 'Failed to initiate call',
      details,
    });
  }
});

const handleCallStatus = async (req, res) => {
  try {
    const { callId } = req.params;

    if (MOCK_CALLS || !BOLNA_API_KEY) {
      const result = getScreenings().find((item) => item.callId === callId);
      return res.json({
        callId,
        status: result ? 'completed' : 'queued',
        duration: result ? 300 : 0,
        recording: null,
        savedResultId: result ? result.id : null,
      });
    }

    const execution = await syncCompletedExecution(callId);

    const candidate = findCandidateByCallId(callId);
    if (candidate && execution?.status) {
      await upsertCandidate({ ...candidate, callStatus: execution.status });
    }

    res.json({
      callId,
      status: execution.status,
      duration: execution.telephony_data?.duration || execution.conversation_time || 0,
      recording: execution.telephony_data?.recording_url || null,
      savedResultId: execution.savedResultId || null,
    });
  } catch (error) {
    console.error('❌ Error checking call status:', error.message);
    res.status(500).json({
      error: 'Failed to check call status',
      details: error.message,
    });
  }
};

/**
 * GET/POST /api/call-status/:callId
 * Checks call status with Bolna and saves completed execution data when available.
 */
app.get("/api/call-status/:callId", handleCallStatus);
app.post("/api/call-status/:callId", handleCallStatus);

/* ================= webhook (fail-closed) ================= */

/**
 * POST /api/webhook/screening-complete
 * Receives screening results from Bolna. Fail-closed: disabled unless
 * WEBHOOK_TOKEN is configured, and then only with the matching
 * x-webhook-token header.
 */
app.post("/api/webhook/screening-complete", async (req, res) => {
  try {
    if (!process.env.WEBHOOK_TOKEN) {
      return res.status(503).json({ error: 'Webhook is not configured on this server.' });
    }
    const token = req.headers['x-webhook-token'];
    if (token !== process.env.WEBHOOK_TOKEN) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const screeningData = req.body;

    console.log('📊 Screening results received:', screeningData);

    const { record, changed, pendingReview } = await saveScreeningResult(screeningData);
    console.log(pendingReview ? '🕐 Changed payload stored for human review' : '✅ Screening result saved');

    res.json({
      success: true,
      message: pendingReview
        ? 'Payload differs from the published result - stored as a pending update for human review.'
        : changed
          ? 'Screening results saved successfully'
          : 'Identical payload already recorded - ignored.',
      resultId: record.id,
      pendingReview,
    });
  } catch (error) {
    console.error('❌ Error processing webhook:', error);
    res.status(500).json({
      error: 'Failed to process screening results',
      details: error.message,
    });
  }
});

/* ================= screenings ================= */

/**
 * GET /api/screenings
 * Retrieve all screening results
 */
app.get("/api/screenings", (req, res) => {
  const results = getScreenings();
  res.json({
    total: results.length,
    results,
  });
});

/**
 * GET /api/screenings/:id
 * Retrieve specific screening result
 */
app.get("/api/screenings/:id", (req, res) => {
  const result = getScreenings().find((r) => r.id === req.params.id);
  if (!result) {
    return res.status(404).json({ error: 'Screening not found' });
  }
  res.json(result);
});

/**
 * PATCH /api/screenings/:id/decision
 * Record the human reviewer's decision. The AI recommendation is only a
 * suggestion - shortlisting or rejecting a candidate always comes from
 * this explicit human action, never automatically from the score.
 */
app.patch("/api/screenings/:id/decision", async (req, res) => {
  const decision = String(req.body?.decision || '').toLowerCase();
  const result = await setScreeningDecision(req.params.id, decision);
  if (result === null) {
    return res.status(400).json({ error: "Decision must be 'pending', 'shortlisted' or 'rejected'" });
  }
  if (result === undefined) {
    return res.status(404).json({ error: 'Screening not found' });
  }
  res.json({ success: true, result });
});

/**
 * POST /api/screenings/:id/review-update
 * Human review of a pending updated result: approve publishes it (the
 * decision resets to pending), dismiss drops it.
 */
app.post("/api/screenings/:id/review-update", async (req, res) => {
  const action = String(req.body?.action || '').toLowerCase();
  const result = await reviewScreeningUpdate(req.params.id, action);
  if (result === undefined) return res.status(404).json({ error: 'Screening not found' });
  if (result === null) return res.status(400).json({ error: "No pending update, or action must be 'approve' or 'dismiss'" });
  res.json({ success: true, result });
});

/**
 * DELETE /api/screenings/:id
 * Delete a screening result
 */
app.delete("/api/screenings/:id", async (req, res) => {
  const removed = await removeScreening(req.params.id);
  if (!removed) {
    return res.status(404).json({ error: 'Screening not found' });
  }
  res.json({ success: true, message: 'Screening deleted' });
});

/* ================= health + static ================= */

/**
 * Health check endpoint (public, no candidate data)
 */
app.get("/health", (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date(),
    demoMode: MOCK_CALLS,
    callsMode: MOCK_CALLS ? 'demo' : 'live',
    realCallAllowlistCount: REAL_CALL_ALLOWLIST.length,
    storage: storageDriver,
    authConfigured: Boolean(getOwner()),
  });
});

// Serve the built frontend when present so the whole app runs from one URL.
const DIST_DIR = path.join(process.cwd(), 'dist');
if (fs.existsSync(path.join(DIST_DIR, 'index.html'))) {
  app.use(express.static(DIST_DIR));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/') || req.path === '/health') return next();
    res.sendFile(path.join(DIST_DIR, 'index.html'));
  });
  console.log('🖥️  Serving frontend from ./dist');
}

// Error handling middleware
app.use((err, req, res, next) => {
  void next;
  console.error('🔥 Server error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: err.message,
  });
});

// Start server
await loadStore();
app.listen(PORT, () => {
  console.log(`\n🚀 Aria Backend Server running on http://localhost:${PORT}`);
  console.log(`💾 Storage: ${storageDriver}`);
  console.log(`🧪 Call mode: ${MOCK_CALLS ? 'demo (no real calls)' : 'LIVE - real Bolna calls enabled'}`);
  console.log(`🔐 Owner account: ${getOwner() ? 'configured' : 'not set up yet'}`);
  if (HAS_BOLNA_CREDS) {
    const fp = crypto.createHash('sha256').update(BOLNA_AGENT_ID).digest('hex').slice(0, 12);
    console.log(`🪪 Bolna agent fingerprint (sha256 first 12): ${fp}`);
  }
  console.log(`✅ Health check: http://localhost:${PORT}/health\n`);
});

export default app;
