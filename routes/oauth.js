const express = require('express');
const crypto  = require('crypto');   // built-in — no extra dependency
const router  = express.Router();

const CLIENT_ID     = process.env.OAUTH_CLIENT_ID     || 'sf-practice-client';
const CLIENT_SECRET = process.env.OAUTH_CLIENT_SECRET || 'sf-practice-secret-abc987';
const TOKEN_TTL_SEC = parseInt(process.env.TOKEN_TTL_SEC ?? '3600', 10);

// In-memory store: Map<token, expiresAtMs>
// Sufficient for local practice — does not survive server restarts.
const tokenStore = new Map();

function issueToken() {
  const token = crypto.randomBytes(32).toString('hex');
  tokenStore.set(token, Date.now() + TOKEN_TTL_SEC * 1000);
  return token;
}

function pruneExpired() {
  const now = Date.now();
  for (const [token, exp] of tokenStore) {
    if (exp < now) tokenStore.delete(token);
  }
}

// ── Scenario 4a: Token endpoint ──────────────────────────────────────────────
// Salesforce External Credentials (Client Credentials flow) POST here first.
// Matches RFC 6749 §4.4 response shape so Salesforce accepts it without tweaks.
//
// Test with:
//   curl -X POST http://localhost:3000/oauth/token \
//     -d "grant_type=client_credentials&client_id=sf-practice-client&client_secret=sf-practice-secret-abc987"
router.post('/oauth/token', (req, res) => {
  const { grant_type, client_id, client_secret } = req.body;

  if (grant_type !== 'client_credentials') {
    return res.status(400).json({
      error            : 'unsupported_grant_type',
      error_description: 'Only grant_type=client_credentials is supported.',
    });
  }

  if (client_id !== CLIENT_ID || client_secret !== CLIENT_SECRET) {
    return res.status(401).json({
      error            : 'invalid_client',
      error_description: 'client_id or client_secret is incorrect.',
      hint             : `Expected client_id="${CLIENT_ID}". Set OAUTH_CLIENT_ID / OAUTH_CLIENT_SECRET env vars to change.`,
    });
  }

  pruneExpired();
  const access_token = issueToken();

  res.json({
    access_token,
    token_type: 'Bearer',
    expires_in: TOKEN_TTL_SEC,
    scope     : 'products:read',
  });
});

// ── Bearer token guard ───────────────────────────────────────────────────────
function bearerGuard(req, res, next) {
  const authHeader = req.headers['authorization'] ?? '';
  const token      = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({
      error : 'unauthorized',
      reason: 'Missing Authorization: Bearer <token> header.',
      hint  : 'Call POST /oauth/token first to obtain an access_token.',
    });
  }

  pruneExpired();

  if (!tokenStore.has(token)) {
    return res.status(401).json({
      error : 'invalid_token',
      reason: 'Token not found or expired.',
      hint  : 'Re-authenticate via POST /oauth/token.',
    });
  }

  next();
}

// ── Scenario 4b: Protected resource ─────────────────────────────────────────
// In Salesforce: define an External Credential of type "OAuth 2.0" with
// Client Credentials flow pointing to POST /oauth/token.
// Salesforce auto-refreshes the token and injects "Authorization: Bearer …"
// on every outbound callout — no Apex token management needed.
router.get('/api/v2/products', bearerGuard, (req, res) => {
  res.json({
    scenario : 'Scenario 4 — Modern External Credentials (OAuth 2.0 Client Credentials)',
    products : [
      { id: 'p001', name: 'Enterprise License', price_usd: 4999 },
      { id: 'p002', name: 'Pro Add-on',          price_usd:  299 },
      { id: 'p003', name: 'Support Package',      price_usd:  799 },
    ],
    tip: 'Token valid. Salesforce External Credentials handle the full token lifecycle automatically.',
  });
});

module.exports = router;
