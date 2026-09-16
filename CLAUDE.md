# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A local Node/Express server used to practice Salesforce integration patterns (both directions):
- **Inbound**: Salesforce (Apex/Flow/Named Credentials) calling out to this server.
- **Outbound**: this server acting as a client to Salesforce via a Connected App.

There is no automated test suite or linter configured — verification is done by hitting endpoints with `curl` or by configuring the corresponding Salesforce feature (Remote Site Settings, Named Credential, Connected App, etc.) and observing the callout succeed/fail. Each route file has inline comments describing the exact Salesforce-side setup and `curl` commands to reproduce a scenario — read those comments before changing behavior, since they document the intended failure modes as well as the success path.

## Commands

- `npm start` — run the server once (`node server.js`)
- `npm run dev` — run with `nodemon` (auto-restart on file change)
- `./start-server.sh` — run under `pm2` as `integration-server` (for longer-lived/background use)
- No `test` or `lint` scripts exist in `package.json` — verification is manual (curl, browser, or Salesforce callout).

Server listens on `PORT` (default `3000`). Config is loaded from `.env` (see `.env.example` for every variable and which scenario it belongs to — copy it to `.env` and fill in as needed).

**Logging & debugging:**
- Log level is `info` by default; change it via `LOG_LEVEL` env var or at runtime: `POST /admin/log-level` with `{"level": "debug"}`.
- Logs are Pino JSON (newline-delimited), suitable for log aggregators; errors are scrubbed to avoid leaking credentials.
- Every response is logged once it finishes: 2xx/3xx as info, 4xx as warn (with request params), 5xx as error (with stack trace).

**Certificates:**
- For JWT scenarios, generate a self-signed pair: `bash certs/cert_generator.sh` (creates `server.key`/`server.crt`).
- Download Salesforce's signing cert public key into `certs/sf-jwt-public.crt` for JWT Bearer auth verification.

## Architecture

**Two auth layers, deliberately separate:**
1. **Site login** (`middleware/requireAuth.js` + `routes/auth.js`): a session cookie (`sf.sid`) gates the UI and the outbound Connected App flows. `server.js` applies `requireAuth` to every request *except* the paths in the `PUBLIC_PATHS` set.
2. **Per-scenario auth** implemented inside each practice route (API key, Basic, custom header, JWT, OAuth bearer token): this is the auth Salesforce itself performs when calling this server, and it is intentionally independent of the site session.

When adding a new inbound practice endpoint that Salesforce needs to call directly (no browser/site-session involved), add its path to `PUBLIC_PATHS` in `server.js` or it will be blocked by `requireAuth` before your route ever runs.

**Route files (`routes/`), each modeling one integration surface:**
- `auth.js` — site login/logout pages and session handling; also serves the `/` homepage listing every scenario link.
- `public.js` — inbound scenarios needing no Salesforce-specific credential: Remote Site Settings check, CORS/CSP lab (toggled via `CORS_ENABLED`), a slow endpoint for practicing Apex `Continuation`, and an inbound webhook receiver/inspector (in-memory ring buffer, `MAX_WEBHOOK_EVENTS`).
- `apiKeyAuth.js` — Legacy Named Credential practice via a custom header or `Authorization: ApiKey`.
- `namedCredentials.js` — modern Named/External Credential auth protocols, each as its own guard middleware: Basic, Custom header, JWT Bearer (verifies against certs in `certs/`), and JWT Token Exchange (mints its own short-lived bearer tokens). OAuth 2.0 for Named Credentials is intentionally *not* duplicated here — `GET /api/nc/oauth/info` just points at the shared routes in `oauth.js`.
- `oauth.js` — inbound OAuth 2.0 Client Credentials: `POST /oauth/token` issues tokens, `GET /api/v2/products` is the bearer-protected resource. Tokens are stored in an in-memory `Map` (lost on restart).
- `connectedApp.js` — outbound flows where this server is the OAuth *client* to Salesforce: Client Credentials, Web Server flow with PKCE (`/authorize/web-server-flow` → Salesforce redirects back to `/redirect`), and JWT Bearer (signs an assertion with `certs/server.key`).
- `mcp.js` — inbound MCP (Model Context Protocol) server: `POST /api/mcp` exposes a `search_case_resolutions` tool (mock case-resolution knowledge base) over the Streamable HTTP transport, in stateless mode (fresh `McpServer`/transport per request). Bearer-token auth via `MCP_API_KEY`, independent of the site session — models exposing this server's data to an AI agent rather than to Salesforce directly. Deliberately mocked (no outbound call) so pagination (`startingPage`/`endingPage`/`singlePageRecordCount`, mirroring a real 3rd-party KB/RAG server's contract) and image delivery (`imageUrl` field + optional inline base64 image content blocks, served by the public `GET /api/kb/images/:id` route) can be exercised before wiring up the real integration.

**Certs (`certs/`, gitignored):** `server.key`/`server.crt` are a self-signed pair generated by `certs/cert_generator.sh`, used both to mint local test JWTs and as the outbound JWT Bearer signing key. Salesforce's own public cert (for verifying inbound JWTs) is expected at `certs/<NC_JWT_PUBLIC_CERT>` — download it from Salesforce Setup and drop it in this directory.

**State is all in-memory and non-persistent** (token stores, webhook event log, PKCE code verifiers) — everything resets on server restart, by design for a practice environment.

## Request and error handling

**Middleware stack (server.js):**
1. `requestLogger` — measures response time and logs once the response finishes (status, duration, headers).
2. `session` — manages the site login cookie (`sf.sid`).
3. `requireAuth` — gates every request except those in `PUBLIC_PATHS` set (which Salesforce callouts hit directly).
4. Route handlers.
5. 404 fallback.
6. Central error handler — catches synchronous and async errors (via `asyncHandler` wrapper), logs the stack, and responds.

**Async route handlers:**
- Wrap async handlers with `asyncHandler()` to ensure errors reject properly to the central handler. Without it, rejected promises would bypass logging.

**JSON error shape:**
- `{error, hint, [scenario], [salesforce_setup]}` — always include `hint` for debugging. See existing route files for examples.

## Conventions to preserve

- Route files favor descriptive, comment-heavy code explaining the *Salesforce-side* setup for each scenario (Named Credential/External Credential config, Connected App settings, Apex snippets) — keep this style when adding new scenarios, since the comments are the primary documentation.
- Guard/auth-check functions use `crypto.timingSafeEqual` for credential comparison (see `safeEqual` helpers) rather than `===`, to avoid timing attacks even in this practice context — follow the same pattern for new credential checks.
- JSON error responses consistently include a `hint` (and often `scenario`/`salesforce_setup`) field describing the fix — match this shape for new endpoints rather than returning bare error messages.
