# Aria AI Recruiter

A full-stack AI recruiting workspace that calls candidates, runs a structured phone screen, and brings the screening result back into a simple web dashboard.

Aria is built for the first round of hiring: add a candidate, click **Call**, let the Bolna voice agent ask the screening questions, then review the score, recommendation, notes, and answers in the app.

## Highlights

- **Real outbound AI calls** through Bolna Voice AI
- **Clean recruiter dashboard** with Add, Candidates, and Results views
- **Structured 5-question phone screen** for consistent first-round evaluation
- **Live call status polling** after a call is started
- **Automatic result display** from Bolna webhook or execution lookup
- **Local demo mode** for testing without placing real calls
- **Responsive, minimal UI** built with React, Vite, Zustand, and plain CSS

## Product Flow

```text
Recruiter adds candidate
        ↓
Clicks Call in dashboard
        ↓
Express backend starts Bolna call
        ↓
Aria voice agent screens candidate
        ↓
Bolna returns transcript / extracted data
        ↓
Dashboard shows score, recommendation, and answers
```

## Tech Stack

| Layer | Technology |
| --- | --- |
| Frontend | React, Vite, Zustand, Lucide Icons |
| Backend | Node.js, Express |
| Voice AI | Bolna outbound calling API |
| Styling | Minimal custom CSS |
| Data | In-memory backend store + localStorage candidates |

## Features

### Candidate Intake

Recruiters can add a candidate with name, email, phone number, role, and company. Candidates are saved locally so the workflow survives page refreshes.

### One-Click Calling

The Candidates view starts a Bolna outbound call from the configured agent. The backend formats phone numbers into E.164 format and sends candidate context as `user_data`: candidate id, name, phone, role, company, and field.

### Role-Aware Questions

The Bolna prompt in `bolna-agent-config.json` asks one dynamic role-depth question:

- Technical roles get a project, architecture, debugging, system design, or skill-depth question.
- Sales roles get prospecting, objection handling, quota, pipeline, negotiation, or closing questions.
- Marketing roles get campaign, audience, channel, metric, or testing questions.
- Operations/support/HR/finance roles get process, stakeholder, customer, reporting, or ownership questions.
- Unknown roles get a general role-relevant project question.

### Status Tracking

After a real call starts, the frontend polls `/api/call-status/:callId`. When the execution is complete, the backend fetches the Bolna execution payload and saves the screening result.

### Screening Results

The Results view displays:

- Overall score
- PASS / REJECT recommendation
- Role category
- Candidate phone and role
- Notes or transcript summary
- Strengths and risks
- Answers for background, motivation, skills, availability, and salary
- Per-question scores when Bolna returns them

The Candidates view also shows a compact result preview under the matching candidate once the screening is saved.

### Demo Mode

Set `MOCK_BOLNA_CALLS=true` to generate a sample result without calling a real phone number. This is useful for demos, UI testing, and assignment walkthroughs.

## Setup

```bash
cd /Users/imran/Desktop/imran/recruiting/recruitment
npm install --legacy-peer-deps
```

Create or update `.env`:

```bash
BOLNA_API_KEY=your_bolna_api_key_here
BOLNA_AGENT_ID=your_bolna_agent_uuid_here
MOCK_BOLNA_CALLS=false

PORT=3001
COMPANY_NAME=Aria AI
WEBHOOK_TOKEN=optional_shared_secret
```

For a no-call demo:

```bash
MOCK_BOLNA_CALLS=true
```

## Run

Start frontend and backend together:

```bash
npm start
```

Then open:

```text
http://localhost:5173
```

Backend runs on:

```text
http://localhost:3001
```

## Bolna Requirements

For real phone calls, make sure:

- `BOLNA_API_KEY` is a valid API key from the Bolna dashboard.
- `BOLNA_AGENT_ID` is the real UUID of your Bolna agent.
- `MOCK_BOLNA_CALLS=false`.
- Candidate phone numbers include country code, or are 10-digit Indian numbers that can be converted to `+91...`.
- Your Bolna account has outbound calling enabled and enough credits.

The backend uses:

```text
POST https://api.bolna.ai/call
Authorization: Bearer <api_key>
```

It also checks execution data from:

```text
GET https://api.bolna.ai/agent/:agent_id/execution/:execution_id
```

## API

### `POST /api/initiate-call`

Starts a candidate screening call.

```json
{
  "candidateId": "candidate_123",
  "candidateName": "Priya Sharma",
  "phoneNumber": "9876543210",
  "roleApplied": "Software Engineer"
}
```

### `GET /api/call-status/:callId`

Fetches call status from Bolna. If the call is complete, the backend saves the result.

### `POST /api/webhook/screening-complete`

Receives post-call results from Bolna or a custom webhook function.

### `GET /api/screenings`

Returns all saved screening results.

### `DELETE /api/screenings/:id`

Deletes one screening result.

## Agent Screen

Aria asks five questions:

1. Background and recent work
2. Interest in the role
3. Experience and key skills
4. Notice period and start date
5. Salary expectation

The result should include exact extracted fields. Configure the Bolna `save_screening` tool using `bolna-agent-config.json`, and point the tool URL to your public backend:

```text
https://YOUR_PUBLIC_BACKEND_URL/api/webhook/screening-complete
```

For local testing, use a tunnel such as ngrok and replace `YOUR_PUBLIC_BACKEND_URL` with the tunnel URL. If you leave the tool pointed at `webhook.site`, the app will not receive webhook results, though the backend can still try to fetch completed execution data through Bolna polling.

Map extracted values to fields like:

```text
candidate_id
candidate_name
phone_number
role_applied
role_category
overall_score
recommendation
notes
strengths
risks
answer_q1
answer_q2
answer_q3
answer_q4
answer_q5
score_q1
score_q2
score_q3
score_q4
score_q5
```

## Scripts

```bash
npm run dev      # Vite frontend
npm run server   # Express backend
npm start        # frontend + backend
npm run build    # production build
npm run lint     # ESLint
```

## Current Limitations

- Results are stored in memory on the backend, so they reset when the server restarts.
- Candidate records are stored in browser `localStorage`.
- Production deployment should add a real database and a public webhook URL.
- Real call success depends on Bolna credentials, agent configuration, credits, and phone routing.

## Demo Checklist

1. Start the app with `npm start`.
2. Add a candidate.
3. Go to Candidates.
4. Click **Call**.
5. Wait for call status updates.
6. Open Results to see the screening outcome.

For assignment demos where you do not want to dial a real number, set `MOCK_BOLNA_CALLS=true` and repeat the same flow.
