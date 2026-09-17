const express = require('express');
const crypto  = require('crypto');
const router  = express.Router();

const FAQ_API_KEY = process.env.FAQ_API_KEY || 'faq-practice-key-98765';

function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) {
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

const FAQS = [
  {
    id: 'faq-1',
    category: 'Named Credentials',
    question: 'What is a Named Credential used for?',
    answer: 'It stores the endpoint URL and authentication details for an external callout, so Apex/Flow never handles credentials directly and Remote Site Settings aren\'t needed separately.',
  },
  {
    id: 'faq-2',
    category: 'Named Credentials',
    question: 'What\'s the difference between a Legacy Named Credential and an External Credential + Named Credential pair?',
    answer: 'Legacy Named Credentials bundle the URL and auth together on one record. The newer model splits them: an External Credential holds the auth protocol/principal, a Named Credential holds the URL and points at that External Credential — this split lets multiple Named Credentials share one set of credentials.',
  },
  {
    id: 'faq-3',
    category: 'Auth',
    question: 'Why did my callout return 401 even though the API key looks correct?',
    answer: 'Check for trailing whitespace in the stored credential, confirm the header name matches exactly (headers are case-insensitive but the configured name in the External Credential must still be mapped correctly), and confirm the org isn\'t stripping custom headers due to CSP or a Remote Site Settings mismatch.',
  },
  {
    id: 'faq-4',
    category: 'OAuth',
    question: 'Why does my Client Credentials flow return invalid_client?',
    answer: 'Usually the Connected App\'s "Run As" user is missing the API Enabled permission, or the client_id/client_secret stored in the External Credential principal don\'t match what the token endpoint expects.',
  },
  {
    id: 'faq-5',
    category: 'JWT',
    question: 'My JWT Bearer callout fails verification — what should I check first?',
    answer: 'Confirm the signing certificate used by the caller matches the public certificate uploaded on the receiving side, that aud/iss claims match what the verifier expects, and that clock skew between the two systems is within the configured tolerance.',
  },
  {
    id: 'faq-6',
    category: 'Apex',
    question: 'Why does my Apex callout time out or hang the page?',
    answer: 'Synchronous Apex callouts block the transaction. For long-running external calls from a Visualforce/LWC context, use Apex Continuation so the callout runs asynchronously without holding a server resource for the whole duration.',
  },
  {
    id: 'faq-7',
    category: 'Webhooks',
    question: 'How do I verify an inbound webhook actually came from the expected sender?',
    answer: 'Require a shared-secret header (e.g. X-Webhook-Secret) on every inbound POST and reject requests where it\'s missing or doesn\'t match, using a constant-time comparison rather than a simple string equality check.',
  },
  {
    id: 'faq-8',
    category: 'Rate Limits',
    question: 'What\'s the fastest way to reduce API call volume against Salesforce limits?',
    answer: 'Batch operations through Bulk API 2.0 or composite/batch requests instead of one call per record, and cache read-heavy reference data locally instead of re-querying it on every request.',
  },
];

// ── Guard middleware ─────────────────────────────────────────────────────────
// Deliberately simple: a single static header, compared with timingSafeEqual.
// No Basic/JWT/OAuth — just X-API-KEY.
function faqApiKeyGuard(req, res, next) {
  const provided = req.headers['x-api-key'];

  if (!provided) {
    return res.status(401).json({
      error: 'Unauthorized',
      reason: 'Missing X-API-KEY header.',
      hint: 'Send X-API-KEY: <key>.',
    });
  }

  if (!safeEqual(provided, FAQ_API_KEY)) {
    return res.status(401).json({
      error: 'Unauthorized',
      reason: 'API key is invalid.',
      hint: 'Check the key configured in your Named Credential matches FAQ_API_KEY in .env.',
    });
  }

  next();
}

// ── Scenario: FAQ API (simple API-key auth) ─────────────────────────────────
// Practice: configure a Named Credential/External Credential with a Custom
// header X-API-KEY, or just curl it directly:
//   curl -H "X-API-KEY: faq-practice-key-98765" http://localhost:3000/api/faqs
router.get('/api/faqs', faqApiKeyGuard, (req, res) => {
  res.json({
    scenario: 'FAQ API — simple API-key auth',
    authenticated_via: 'X-API-KEY',
    faqs: FAQS,
    salesforce_setup: [
      'Create External Credential → Authentication Protocol: Custom.',
      'Add custom header: X-API-KEY = <FAQ_API_KEY from .env>.',
      'Create Named Credential → URL = this server base URL.',
      "Apex: req.setEndpoint('callout:YourNamedCred/api/faqs');",
    ],
  });
});

module.exports = router;
