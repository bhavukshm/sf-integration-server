/**
 * Requires an authenticated site session.
 * Unauthenticated browser requests are redirected to /login.
 * Unauthenticated API/XHR requests receive 401 JSON.
 */
function requireAuth(req, res, next) {
  if (req.session?.authenticated) {
    return next();
  }

  const wantsHtml = Boolean(req.accepts('html'));
  if (wantsHtml && (req.method === 'GET' || req.method === 'HEAD')) {
    const nextUrl = encodeURIComponent(req.originalUrl || '/');
    return res.redirect(`/login?next=${nextUrl}`);
  }

  return res.status(401).json({
    error : 'Unauthorized',
    reason: 'Login required.',
    login : '/login',
  });
}

module.exports = requireAuth;
