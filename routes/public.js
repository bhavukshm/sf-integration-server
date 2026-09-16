const express = require('express');
const cors    = require('cors');
const crypto  = require('crypto');
const router  = express.Router();

// ── CORS toggle ──────────────────────────────────────────────────────────────
// Set CORS_ENABLED=false in .env, then restart to intentionally break
// browser-side LWC fetches and observe the "Blocked by CORS policy" error.
const corsEnabled = (process.env.CORS_ENABLED ?? 'true') === 'true';

const corsMiddleware = corsEnabled
  ? cors({ origin: process.env.CORS_ORIGIN || '*', methods: ['GET', 'POST'] })
  : (_req, _res, next) => next(); // No CORS headers → browser blocks the request

const CONTINUATION_DEFAULT_DELAY_MS = parseInt(process.env.CONTINUATION_DELAY_MS ?? '3000', 10);
const CONTINUATION_MAX_DELAY_MS     = parseInt(process.env.CONTINUATION_MAX_DELAY_MS ?? '10000', 10);
const WEBHOOK_SECRET                = process.env.WEBHOOK_SECRET || '';
const MAX_WEBHOOK_EVENTS            = 50;

// In-memory log of inbound webhook payloads (resets on server restart).
const webhookEvents = [];

// ── Scenario 1: Remote Site Settings ────────────────────────────────────────
// Apex HttpRequest to this endpoint will throw:
//   "Unauthorized endpoint, please check Setup > Security > Remote Site Settings"
// Fix: add this server's base URL to Remote Site Settings in Salesforce Setup.
router.get('/api/public/weather', (req, res) => {
  res.json({
    scenario    : 'Scenario 1 — Remote Site Settings',
    location    : 'San Francisco, CA',
    temp_c      : 18,
    condition   : 'Foggy',
    retrieved_at: new Date().toISOString(),
    fix_hint    : 'Add this server URL to Setup → Security → Remote Site Settings.',
  });
});

// ── Scenario 2: CORS / CSP Error Lab ────────────────────────────────────────
// LWC fetch() to this endpoint will be blocked by the browser when CORS_ENABLED=false.
// Fix: set CORS_ENABLED=true and restart, or configure a CSP Trusted Site in Salesforce.
router.get('/api/public/browser-data', corsMiddleware, (req, res) => {
  res.json({
    scenario    : 'Scenario 2 — CORS / CSP Lab',
    cors_active : corsEnabled,
    status_msg  : corsEnabled
      ? 'CORS headers present — LWC fetch will succeed.'
      : 'No CORS headers — this response should never reach the browser.',
    fix_hint    : 'Toggle CORS_ENABLED in .env, or add a Trusted Site in Setup → CSP Trusted Sites.',
    data        : [
      { id: 1, label: 'Widget A', value: 42 },
      { id: 2, label: 'Widget B', value: 87 },
    ],
  });
});

// ── Scenario 5: Continuation (slow callout lab) ─────────────────────────────
// Apex synchronous callouts time out around 10s; Continuation.startRequest()
// offloads the HTTP call so the UI stays responsive. This endpoint sleeps
// before responding so you can see the async pattern in action.
//
// Test:
//   curl "http://localhost:3000/api/public/slow-report?delay_ms=5000"
//
// Apex sketch:
//   HttpRequest req = new HttpRequest();
//   req.setEndpoint('http://localhost:3000/api/public/slow-report?delay_ms=4000');
//   req.setMethod('GET');
//   return Continuation.startRequest(req);
router.get('/api/public/slow-report', corsMiddleware, async (req, res) => {
  const requested = parseInt(req.query.delay_ms ?? CONTINUATION_DEFAULT_DELAY_MS, 10);
  const delayMs = Number.isFinite(requested)
    ? Math.min(Math.max(requested, 0), CONTINUATION_MAX_DELAY_MS)
    : CONTINUATION_DEFAULT_DELAY_MS;

  const startedAt = Date.now();
  await new Promise((resolve) => setTimeout(resolve, delayMs));

  res.json({
    scenario     : 'Scenario 5 — Continuation (async callout lab)',
    delay_ms     : delayMs,
    started_at   : new Date(startedAt).toISOString(),
    completed_at : new Date().toISOString(),
    report       : {
      region              : 'EMEA',
      pipeline_value_usd  : 1_240_000,
      open_opportunities  : 17,
      forecast            : 'Commit',
      owner               : 'Integration Practice',
    },
    practice_tips: [
      'Add this URL to Remote Site Settings before calling from Apex.',
      'Use Continuation.startRequest(req) in an @AuraEnabled method (VF/LWC).',
      'Handle the Continuation callback in JavaScript to parse the response body.',
      'Compare with a plain Http.send() — the page will feel blocked on long delays.',
    ],
    query_params : {
      delay_ms: `Optional. 0–${CONTINUATION_MAX_DELAY_MS} (default ${CONTINUATION_DEFAULT_DELAY_MS}).`,
    },
  });
});

// ── Scenario 6: Inbound webhooks (hooks) ────────────────────────────────────
// External systems (or Salesforce Flow / Apex) POST event payloads here.
// Inspect what arrived via GET /api/public/webhook/events.
//
// Test:
//   curl -X POST http://localhost:3000/api/public/webhook \
//     -H "Content-Type: application/json" \
//     -d '{"event":"account.updated","recordId":"001xx"}'
//
// Optional shared secret (set WEBHOOK_SECRET in .env):
//   curl -X POST ... -H "X-Webhook-Secret: your-secret" -d '{...}'
router.post('/api/public/webhook', (req, res) => {
  const providedSecret =
    req.headers['x-webhook-secret'] ??
    req.headers['x-api-key'] ??
    '';

  if (WEBHOOK_SECRET && providedSecret !== WEBHOOK_SECRET) {
    return res.status(401).json({
      scenario : 'Scenario 6 — Inbound Webhooks',
      error    : 'Unauthorized',
      reason   : 'Invalid or missing X-Webhook-Secret header.',
      hint     : 'Set WEBHOOK_SECRET in .env and send the same value as X-Webhook-Secret.',
    });
  }

  const event = {
    id          : crypto.randomUUID(),
    received_at : new Date().toISOString(),
    method      : req.method,
    path        : req.path,
    source_ip   : req.ip,
    headers     : {
      'content-type'    : req.headers['content-type'],
      'user-agent'      : req.headers['user-agent'],
      'x-webhook-secret': req.headers['x-webhook-secret'] ? '(present)' : undefined,
      'x-sfdc-signature': req.headers['x-sfdc-signature'],
    },
    body: req.body,
  };

  webhookEvents.unshift(event);
  if (webhookEvents.length > MAX_WEBHOOK_EVENTS) {
    webhookEvents.length = MAX_WEBHOOK_EVENTS;
  }

  console.log(`[webhook] ${event.id} from ${event.source_ip}`);

  res.status(202).json({
    scenario   : 'Scenario 6 — Inbound Webhooks',
    accepted   : true,
    event_id   : event.id,
    received_at: event.received_at,
    tip        : 'GET /api/public/webhook/events to review payloads received by this server.',
  });
});

router.get('/api/public/webhook/events', corsMiddleware, (req, res) => {
  res.json({
    scenario        : 'Scenario 6 — Inbound Webhooks',
    secret_required : Boolean(WEBHOOK_SECRET),
    event_count     : webhookEvents.length,
    events          : webhookEvents,
    salesforce_ideas: [
      'Flow: Create Record → Action "HTTP Callout" POSTing JSON to /api/public/webhook.',
      'Apex: @future or Queueable Http.send() after DML to notify this endpoint.',
      'Outbound Message (legacy): SOAP POST to a public URL — same hook idea.',
      'Platform Events: subscriber Apex can forward events here as a webhook relay.',
    ],
    fix_hints: [
      'Add this server to Remote Site Settings for Apex/Flow callouts.',
      'For Named Credentials, map a custom header to X-Webhook-Secret.',
    ],
  });
});

module.exports = router;
