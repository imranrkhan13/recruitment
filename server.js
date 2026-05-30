/**
 * Backend Server for Aria AI Recruiter
 * Handles Bolna API calls, webhooks, and screening data management
 *
 * Run with: node server.js
 */

import express from 'express';
import cors from 'cors';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();
dotenv.config({ path: '.env.local' });

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// In-memory database for demo (use real DB in production)
const screeningResults = [];
const candidates = [];

// Bolna Configuration
const BOLNA_API_KEY = (process.env.BOLNA_API_KEY || process.env.VITE_BOLNA_API_KEY || '').trim();
const BOLNA_AGENT_ID = (process.env.BOLNA_AGENT_ID || process.env.VITE_BOLNA_AGENT_ID || '').trim();
const MOCK_CALLS = process.env.MOCK_BOLNA_CALLS === 'true' || (!BOLNA_API_KEY || !BOLNA_AGENT_ID);
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
    notes: 'Demo screening result generated locally. Set MOCK_BOLNA_CALLS=false with Bolna credentials to place real calls.',
    roleCategory: 'role-specific',
    strengths: 'Clear communication, relevant experience, and practical role understanding.',
    risks: 'Demo data only. Use a real Bolna call for true candidate signals.',
    questionScores: {
      q1: 80,
      q2: 78,
      q3: score,
      q4: 82,
      q5: 76,
    },
    answers: {
      q1: `${candidateName} described relevant recent work and communicated clearly.`,
      q2: `They expressed interest in the ${roleApplied} role and the team's problem space.`,
      q3: `They answered a practical ${roleApplied} scenario with role-aligned skills and examples.`,
      q4: 'They are available within a reasonable notice period.',
      q5: 'Salary expectations were within a negotiable range.',
    },
    callId,
    receivedAt: new Date(),
  };
};

const saveScreeningResult = (screeningData) => {
  const extractedData = screeningData.extracted_data || screeningData.extractedData || {};
  const extractedScore = getExtractedValue(extractedData, ['overall_score', 'overall score', 'score']);
  const overallScore = Number(
    extractedScore || screeningData.overall_score || screeningData.overallScore || screeningData.score || 0
  );

  const result = {
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

  const existingIndex = screeningResults.findIndex(
    (item) => item.id === result.id || (result.callId && item.callId === result.callId)
  );

  if (existingIndex >= 0) {
    screeningResults[existingIndex] = result;
  } else {
    screeningResults.push(result);
  }

  return result;
};

const syncCompletedExecution = async (callId) => {
  if (MOCK_CALLS || !BOLNA_API_KEY || !BOLNA_AGENT_ID) return null;

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

  const candidate = candidates.find((item) => item.callId === callId);
  const result = saveScreeningResult({
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

  return { ...execution, savedResultId: result.id };
};

/**
 * POST /api/initiate-call
 * Initiates a phone screening call via Bolna
 */
app.post('${import.meta.env.VITE_API_URL}/api/initiate-call', async (req, res) => {
  try {
    const { candidateId, candidateName, phoneNumber, roleApplied } = req.body;

    // Validate input
    if (!candidateName || !phoneNumber || !roleApplied) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Prepare call data for Bolna
    const callId = `call_${Date.now()}`;
    const shouldMockCall = MOCK_CALLS || !BOLNA_API_KEY || !BOLNA_AGENT_ID;
    const formattedPhoneNumber = normalizePhoneNumber(phoneNumber);

    if (!shouldMockCall && !UUID_PATTERN.test(BOLNA_AGENT_ID)) {
      return res.status(400).json({
        error: 'Bolna agent ID must be a real UUID',
        details: 'Update BOLNA_AGENT_ID in .env.local with the UUID from your Bolna dashboard. The current value looks like a placeholder.',
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
        screeningResults.push(result);
        console.log('✅ Demo screening result saved:', result.id);
      }, 2500);
    }

    // Store candidate locally
    candidates.push({
      id: candidateId || callData.call_id,
      name: candidateName,
      phone: formattedPhoneNumber,
      role: roleApplied,
      callId: callData.call_id,
      initiatedAt: new Date(),
    });

    res.json({
      success: true,
      callId: callData.call_id,
      demoMode: shouldMockCall,
      message: shouldMockCall
        ? `Demo call queued for ${candidateName}. A sample result will appear shortly.`
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

/**
 * POST /api/webhook/screening-complete
 * Receives screening results from Bolna agent
 * This is called by the Bolna agent after completing the 5-question screening
 */
app.post('${import.meta.env.VITE_API_URL}/api/webhook/screening-complete', async (req, res) => {
  try {
    const screeningData = req.body;

    console.log('📊 Screening results received:', screeningData);

    // Validate webhook (optional but recommended)
    // const token = req.headers['x-webhook-token'];
    // if (token !== process.env.WEBHOOK_TOKEN) {
    //   return res.status(401).json({ error: 'Unauthorized' });
    // }

    const result = saveScreeningResult(screeningData);
    console.log('✅ Screening result saved');

    res.json({
      success: true,
      message: 'Screening results saved successfully',
      resultId: result.id,
    });
  } catch (error) {
    console.error('❌ Error processing webhook:', error);
    res.status(500).json({
      error: 'Failed to process screening results',
      details: error.message,
    });
  }
});

/**
 * GET /api/screenings
 * Retrieve all screening results
 */
app.get('${import.meta.env.VITE_API_URL}/api/screenings', (req, res) => {
  res.json({
    total: screeningResults.length,
    results: screeningResults,
  });
});

/**
 * GET /api/screenings/:id
 * Retrieve specific screening result
 */
app.get('${import.meta.env.VITE_API_URL}/api/screenings/:id', (req, res) => {
  const result = screeningResults.find((r) => r.id === req.params.id);
  if (!result) {
    return res.status(404).json({ error: 'Screening not found' });
  }
  res.json(result);
});

/**
 * DELETE /api/screenings/:id
 * Delete a screening result
 */
app.delete('${import.meta.env.VITE_API_URL}/api/screenings/:id', (req, res) => {
  const index = screeningResults.findIndex((r) => r.id === req.params.id);
  if (index === -1) {
    return res.status(404).json({ error: 'Screening not found' });
  }
  screeningResults.splice(index, 1);
  res.json({ success: true, message: 'Screening deleted' });
});

const handleCallStatus = async (req, res) => {
  try {
    const { callId } = req.params;

    if (MOCK_CALLS || !BOLNA_API_KEY) {
      const result = screeningResults.find((item) => item.callId === callId);
      return res.json({
        callId,
        status: result ? 'completed' : 'queued',
        duration: result ? 300 : 0,
        recording: null,
      });
    }

    const execution = await syncCompletedExecution(callId);

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
app.get('${import.meta.env.VITE_API_URL}/api/call-status/:callId', handleCallStatus);
app.post('${import.meta.env.VITE_API_URL}/api/call-status/:callId', handleCallStatus);

/**
 * Health check endpoint
 */
app.get('${import.meta.env.VITE_API_URL}/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date(),
    screeningsRecorded: screeningResults.length,
    demoMode: MOCK_CALLS || !BOLNA_API_KEY || !BOLNA_AGENT_ID,
  });
});

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
app.listen(PORT, () => {
  console.log(`\n🚀 Aria Backend Server running on ${import.meta.env.VITE_API_URL}`);
  console.log(`📊 Webhooks endpoint: ${import.meta.env.VITE_API_URL}/api/webhook/screening-complete`);
  console.log(`🧪 Demo calls: ${MOCK_CALLS || !BOLNA_API_KEY || !BOLNA_AGENT_ID ? 'enabled' : 'disabled'}`);
  console.log(`✅ Health check: ${import.meta.env.VITE_API_URL}/health\n`);
});

export default app;
