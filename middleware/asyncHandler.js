// Express 4 does not catch rejected promises from async route handlers —
// an unhandled rejection would bypass the central error handler entirely,
// so 5xx errors from routes like connectedApp.js would never get logged
// with a stack trace. Wrap async handlers with this so next(err) is called.
function asyncHandler(fn) {
    return (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch(next)
    }
}

module.exports = asyncHandler
