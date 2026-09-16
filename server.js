require('dotenv').config();
const express = require('express');
const session = require('express-session');
const requireAuth = require('./middleware/requireAuth');
const requestLogger = require('./middleware/requestLogger');
const { logger } = require('./logger');

const app = express();
const PORT = process.env.PORT || 3000;

// Nginx reverse-proxy compatibility: trust X-Forwarded-* headers
app.set('trust proxy', 1);

// First in the stack so responseTimeMs covers the full request lifecycle.
app.use(requestLogger);

app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.use(
  session({
    name: 'sf.sid',
    secret: process.env.SESSION_SECRET || 'sf-practice-dev-session-secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      // Set COOKIE_SECURE=true when serving over HTTPS (e.g. behind nginx TLS)
      secure: process.env.COOKIE_SECURE === 'true',
      maxAge: 24 * 60 * 60 * 1000,
    },
  })
);

// Inbound Salesforce practice APIs keep their own auth (none / API key / OAuth).
// Everything else (UI + Connected App practice flows) requires site login.
// Exact paths + prefixes that Salesforce callouts hit (no site-login cookie).
const PUBLIC_PATHS = new Set([
  '/login',
  '/logout',
  '/api/public/weather',
  '/api/public/browser-data',
  '/api/public/slow-report',
  '/api/public/webhook',
  '/api/public/webhook/events',
  '/api/v1/secure-data',
  '/api/v2/products',
  '/oauth/token',
  // Named Credentials practice (SF → this server)
  '/api/nc/basic/orders',
  '/api/nc/custom/inventory',
  '/api/nc/jwt/accounts',
  '/api/nc/jwt-exchange/token',
  '/api/nc/jwt-exchange/data',
  '/api/nc/oauth/info',
  // MCP server (AI agents → this server)
  '/api/mcp',
]);

// Path prefixes for public routes with a dynamic segment (exact-match Set
// above can't cover these) — currently just the MCP knowledge base's
// per-resolution mock image endpoint.
const PUBLIC_PATH_PREFIXES = ['/api/kb/images/'];

app.use((req, res, next) => {
  if (PUBLIC_PATHS.has(req.path) || PUBLIC_PATH_PREFIXES.some((prefix) => req.path.startsWith(prefix))) {
    return next();
  }
  return requireAuth(req, res, next);
});

app.use('/', require('./routes/auth'));
app.use('/', require('./routes/admin'));
app.use('/', require('./routes/public'));
app.use('/', require('./routes/apiKeyAuth'));
app.use('/', require('./routes/oauth'));
app.use('/', require('./routes/namedCredentials'));
app.use('/', require('./routes/connectedApp'));
app.use('/', require('./routes/mcp'));

app.use((req, res) => {
  res.status(404).json({ error: 'Not Found', path: req.path });
});

// Central error handler — must be last. Stashes the error on res.locals so
// requestLogger's 'finish' listener can log the stack trace, then responds.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  res.locals.err = err;
  const status = err.status || err.statusCode || 500;
  if (!res.headersSent) {
    res.status(status).json({ error: 'Internal Server Error' });
  }
});

const server = app.listen(PORT, () => {
  logger.info(`[server] Listening on http://localhost:${PORT}`);
  logger.info(`[server] Site auth       : enabled (POST /login)`);
  logger.info(`[server] Log level       : ${logger.level} (change via LOG_LEVEL or POST /admin/log-level)`);
  logger.info(`[server] APP_USERNAME    : ${process.env.APP_USERNAME || 'admin (default)'}`);
  logger.info(`[server] CORS_ENABLED    : ${process.env.CORS_ENABLED   ?? 'true (default)'}`);
  logger.info(`[server] NC Basic        : ${process.env.NC_BASIC_USERNAME || 'nc-basic-user (default)'}`);
  logger.info(`[server] NC Custom header: ${process.env.NC_CUSTOM_HEADER_NAME || 'X-API-KEY (default)'}`);
  logger.info(`[server] API_KEY         : ${process.env.API_KEY         ?? 'sf-practice-key-12345 (default)'}`);
  logger.info(`[server] OAUTH_CLIENT_ID : ${process.env.OAUTH_CLIENT_ID ?? 'sf-practice-client (default)'}`);
  logger.info(`[server] SF_CLIENT_ID    : ${process.env.SF_CLIENT_ID    ? 'set' : 'missing'}`);
});

// Graceful shutdown on SIGINT/SIGTERM
function shutdown() {
  server.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
