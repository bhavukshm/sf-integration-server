const express = require('express');
const crypto  = require('crypto');
const qs      = require('qs');
const axios   = require('axios');
const fs      = require('fs');
const path    = require('path');
const jwt     = require('jsonwebtoken');
const asyncHandler = require('../middleware/asyncHandler');

const router = express.Router();

// ── Salesforce Connected App credentials ─────────────────────────────────────
// These authenticate OUTBOUND to Salesforce (your Connected App).
// Contrast with routes/oauth.js, which accepts INBOUND tokens from Salesforce.
const SF_LOGIN_URL    = process.env.SF_LOGIN_URL    || 'https://login.salesforce.com';
const SF_TOKEN_URL    = process.env.SF_TOKEN_URL    || '';
const SF_CLIENT_ID    = process.env.SF_CLIENT_ID    || '';
const SF_CLIENT_SECRET = process.env.SF_CLIENT_SECRET || '';
const SF_REDIRECT_URI = process.env.SF_REDIRECT_URI || 'http://localhost:3000/redirect';
const SF_JWT_USERNAME = process.env.SF_JWT_USERNAME || '';
const SF_CERT_DIR     = process.env.SF_CERT_DIR     || 'certs';

// Store code_verifier temporarily (use session/Redis in production)
const codeVerifiers = new Map();

function generatePKCE() {
  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto
    .createHash('sha256')
    .update(codeVerifier)
    .digest('base64url');

  codeVerifiers.set('verifier', codeVerifier);

  return { codeVerifier, codeChallenge };
}

// ── Health / debug callback ──────────────────────────────────────────────────
router.get('/callback', asyncHandler(async (req, res) => {
  console.log(`\n\nCALLBACK\n\n ${req}`);
  let endPoint = `${SF_TOKEN_URL}/services/data/v64.0/sObject/Account`;
  let result = await axios.get(endPoint);
  console.log('Result: ', result);
  res.json(req.headers);
}));

// ── Connected App: Client Credentials flow ───────────────────────────────────
// Practice: Connected App with "Client Credentials Flow" enabled.
// Returns access_token for server-to-server callouts (no user context).
router.get('/authorize/client-creds-flow', asyncHandler(async (req, res) => {
  const data = qs.stringify({
    grant_type   : 'client_credentials',
    client_id    : SF_CLIENT_ID,
    client_secret: SF_CLIENT_SECRET,
  });

  const config = {
    method: 'post',
    maxBodyLength: Infinity,
    url: SF_TOKEN_URL,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    data,
  };

  const result = await axios.request(config);
  res.json(result.data);
}));

// ── Connected App: Web Server flow (PKCE) — Part 1 ───────────────────────────
// Redirects the browser to Salesforce authorize. Callback hits /redirect.
router.get('/authorize/web-server-flow', (req, res) => {
  const { codeVerifier, codeChallenge } = generatePKCE();

  const state = crypto.randomBytes(16).toString('hex');
  codeVerifiers.set(state, codeVerifier);

  const authUrl =
    `${SF_LOGIN_URL}/services/oauth2/authorize?` +
    `response_type=code&` +
    `client_id=${SF_CLIENT_ID}&` +
    `redirect_uri=${SF_REDIRECT_URI}&` +
    `scope=api refresh_token offline_access&` +
    `code_challenge=${codeChallenge}&` +
    `code_challenge_method=S256&` +
    `state=${state}`;

  console.log(`Redirect URL::: \n ${authUrl}`);
  console.log(`Code Verifier::: ${codeVerifier}`);
  res.redirect(authUrl);
});

// ── Connected App: Web Server flow (PKCE) — Part 2 ───────────────────────────
// Salesforce redirects here with ?code=…; exchange for access_token.
router.get('/redirect', asyncHandler(async (req, res) => {
  console.log('Request: ', req.query);
  const exchangeCode = req?.query?.code;
  const verifier = codeVerifiers.get('verifier');

  const config = {
    method: 'post',
    data: {
      code         : exchangeCode,
      grant_type   : 'authorization_code',
      client_id    : SF_CLIENT_ID,
      client_secret: SF_CLIENT_SECRET,
      redirect_uri : SF_REDIRECT_URI,
      code_verifier: verifier,
      format       : 'json',
    },
    url: SF_TOKEN_URL,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
  };

  console.log(`Config::: ${JSON.stringify(config)}`);
  const excRes = await axios.request(config);

  console.log(`excResponse: ${excRes.data}`);
  console.log(`excResponse: ${excRes.data.access_token}`);

  res.json({
    sessionId: excRes.data.access_token,
  });
}));

// ── Connected App: JWT Bearer Token flow ─────────────────────────────────────
// Practice: Connected App with a certificate; private key lives in SF_CERT_DIR.
// Signs a short-lived JWT assertion and exchanges it for an access_token.
router.get('/authorize/jwt-token-flow', asyncHandler(async (req, res) => {
  console.log(`Request: ${req}`);
  const privateKeyPath = path.join(__dirname, '..', SF_CERT_DIR, 'server.key');

  if (!fs.existsSync(privateKeyPath)) {
    throw new Error('server.key file not found.');
  }

  const privateKey = fs.readFileSync(privateKeyPath, 'utf8');

  const payload = {
    iss: SF_CLIENT_ID,
    sub: SF_JWT_USERNAME,
    aud: SF_TOKEN_URL,
    exp: Math.floor(Date.now() / 1000) + (3 * 60),
  };

  console.log('Signing JWT assertion...');
  const assertion = jwt.sign(payload, privateKey, { algorithm: 'RS256' });

  const config = {
    method: 'post',
    url: SF_TOKEN_URL,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    data: {
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    },
  };

  console.log(`Sending token request to: ${SF_TOKEN_URL}`);

  const response = await axios.request(config);
  const sessionId = response.data.access_token;

  res.json({
    sessionToken: sessionId,
  });
}));

module.exports = router;
