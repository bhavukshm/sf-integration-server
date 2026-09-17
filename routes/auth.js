const express = require('express');
const crypto  = require('crypto');
const router  = express.Router();

const APP_USERNAME = process.env.APP_USERNAME || 'admin';
const APP_PASSWORD = process.env.APP_PASSWORD || 'changeme';

function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) {
    // Still compare to keep timing roughly constant
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function loginPage(errorMessage = '', nextPath = '/') {
  const errorHtml = errorMessage
    ? `<p class="error">${escapeHtml(errorMessage)}</p>`
    : '';
  const safeNext = nextPath.startsWith('/') ? nextPath : '/';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Sign in — SF Integration Practice</title>
  <style>
    :root {
      --bg: #0f1419;
      --card: #1a2332;
      --text: #e7ecf3;
      --muted: #8b9bb4;
      --accent: #3d8bfd;
      --accent-hover: #5a9dff;
      --error: #f07178;
      --border: #2a3548;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      font-family: "Segoe UI", system-ui, sans-serif;
      background:
        radial-gradient(ellipse at 20% 0%, #1e3a5f 0%, transparent 50%),
        radial-gradient(ellipse at 80% 100%, #1a2f45 0%, transparent 45%),
        var(--bg);
      color: var(--text);
    }
    .panel {
      width: min(100% - 2rem, 380px);
      padding: 2rem;
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 12px;
    }
    h1 {
      margin: 0 0 0.35rem;
      font-size: 1.35rem;
      font-weight: 600;
    }
    .sub {
      margin: 0 0 1.5rem;
      color: var(--muted);
      font-size: 0.9rem;
    }
    label {
      display: block;
      margin-bottom: 0.35rem;
      font-size: 0.85rem;
      color: var(--muted);
    }
    input {
      width: 100%;
      margin-bottom: 1rem;
      padding: 0.65rem 0.75rem;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: #121822;
      color: var(--text);
      font-size: 1rem;
    }
    input:focus {
      outline: 2px solid var(--accent);
      outline-offset: 1px;
    }
    button {
      width: 100%;
      margin-top: 0.25rem;
      padding: 0.7rem 1rem;
      border: none;
      border-radius: 8px;
      background: var(--accent);
      color: #fff;
      font-size: 1rem;
      font-weight: 600;
      cursor: pointer;
    }
    button:hover { background: var(--accent-hover); }
    .error {
      margin: 0 0 1rem;
      padding: 0.65rem 0.75rem;
      border-radius: 8px;
      background: rgba(240, 113, 120, 0.12);
      color: var(--error);
      font-size: 0.9rem;
    }
  </style>
</head>
<body>
  <main class="panel">
    <h1>SF Integration Practice</h1>
    <p class="sub">Sign in to continue</p>
    ${errorHtml}
    <form method="POST" action="/login">
      <input type="hidden" name="next" value="${escapeHtml(safeNext)}" />
      <label for="username">Username</label>
      <input id="username" name="username" type="text" autocomplete="username" required autofocus />
      <label for="password">Password</label>
      <input id="password" name="password" type="password" autocomplete="current-password" required />
      <button type="submit">Sign in</button>
    </form>
  </main>
</body>
</html>`;
}

function homePage(base) {
  const links = [
    { path: '/api/public/weather',            label: 'Public weather (Remote Site Settings)' },
    { path: '/api/public/browser-data',       label: 'Browser data (CORS lab)' },
    { path: '/api/public/slow-report',        label: 'Slow report (Continuation lab)' },
    { path: '/api/public/webhook/events',     label: 'Webhook inbox (hooks lab)' },
    { path: '/api/nc/basic/orders',           label: 'Named Cred — Basic Auth' },
    { path: '/api/nc/custom/inventory',       label: 'Named Cred — Custom Auth' },
    { path: '/api/nc/jwt/accounts',           label: 'Named Cred — JWT Bearer' },
    { path: '/api/nc/jwt-exchange/data',      label: 'Named Cred — JWT Token Exchange' },
    { path: '/api/nc/oauth/info',             label: 'Named Cred — OAuth 2.0 (setup info)' },
    { path: '/api/v1/secure-data',            label: 'Legacy Named Cred — API key' },
    { path: '/api/faqs',                      label: 'FAQ API — simple API-key auth' },
    { path: '/api/v2/products',               label: 'OAuth resource (Bearer token)' },
    { path: '/authorize/client-creds-flow',   label: 'Connected App — Client Credentials' },
    { path: '/authorize/web-server-flow',     label: 'Connected App — Web Server (PKCE)' },
    { path: '/authorize/jwt-token-flow',      label: 'Connected App — JWT Bearer' },
  ];

  const items = links
    .map(
      ({ path, label }) =>
        `<li><a href="${path}"><code>${path}</code></a><span>${label}</span></li>`
    )
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>SF Integration Practice</title>
  <style>
    :root {
      --bg: #0f1419;
      --card: #1a2332;
      --text: #e7ecf3;
      --muted: #8b9bb4;
      --accent: #3d8bfd;
      --border: #2a3548;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: "Segoe UI", system-ui, sans-serif;
      background:
        radial-gradient(ellipse at 20% 0%, #1e3a5f 0%, transparent 50%),
        var(--bg);
      color: var(--text);
    }
    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      padding: 1.25rem 1.5rem;
      border-bottom: 1px solid var(--border);
    }
    h1 { margin: 0; font-size: 1.15rem; font-weight: 600; }
    form { margin: 0; }
    button {
      padding: 0.45rem 0.85rem;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: transparent;
      color: var(--muted);
      cursor: pointer;
      font-size: 0.9rem;
    }
    button:hover { color: var(--text); border-color: var(--muted); }
    main { padding: 1.5rem; max-width: 720px; }
    p { color: var(--muted); margin: 0 0 1.25rem; }
    ul { list-style: none; padding: 0; margin: 0; }
    li {
      display: flex;
      flex-direction: column;
      gap: 0.2rem;
      padding: 0.9rem 1rem;
      margin-bottom: 0.5rem;
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 10px;
    }
    a { color: var(--accent); text-decoration: none; }
    a:hover { text-decoration: underline; }
    code { font-size: 0.92rem; }
    span { color: var(--muted); font-size: 0.85rem; }
  </style>
</head>
<body>
  <header>
    <h1>SF Integration Practice</h1>
    <form method="POST" action="/logout">
      <button type="submit">Sign out</button>
    </form>
  </header>
  <main>
    <p>Signed in. Base URL: <code>${base}</code></p>
    <ul>
      ${items}
    </ul>
  </main>
</body>
</html>`;
}

function resolveNextPath(value) {
  return typeof value === 'string' && value.startsWith('/') ? value : '/';
}

router.get('/login', (req, res) => {
  if (req.session?.authenticated) {
    return res.redirect('/');
  }
  res.type('html').send(loginPage('', resolveNextPath(req.query.next)));
});

router.post('/login', (req, res) => {
  const { username = '', password = '', next: nextBody } = req.body || {};
  const nextPath = resolveNextPath(nextBody);

  const userOk = safeEqual(username, APP_USERNAME);
  const passOk = safeEqual(password, APP_PASSWORD);

  if (!userOk || !passOk) {
    return res.status(401).type('html').send(loginPage('Invalid username or password.', nextPath));
  }

  req.session.authenticated = true;
  req.session.username = APP_USERNAME;

  return res.redirect(nextPath);
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('sf.sid');
    res.redirect('/login');
  });
});

router.get('/', (req, res) => {
  const base = `${req.protocol}://${req.get('host')}`;
  res.type('html').send(homePage(base));
});

module.exports = router;
