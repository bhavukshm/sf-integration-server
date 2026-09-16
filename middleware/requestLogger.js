const {logger} = require('../logger')

/**
 * Logs every request once the response has finished.
 * 2xx/3xx  → single-line info log (method, path, status, duration, user agent).
 * 4xx      → warn, plus params/query for debugging the bad request.
 * 5xx      → error, plus params/query and the stack trace if one was captured
 *            by the central error handler (see server.js) via res.locals.err.
 */
function requestLogger(req, res, next) {
    const startedAt = process.hrtime.bigint()

    res.on('finish', () => {
        const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6

        const fields = {
            method: req.method,
            path: req.originalUrl,
            statusCode: res.statusCode,
            responseTimeMs: Math.round(durationMs * 100) / 100,
            userAgent: req.headers['user-agent'] || '',
        }

        const message = `${req.method} ${req.originalUrl} ${res.statusCode} ${fields.responseTimeMs}ms`

        if (res.statusCode >= 500) {
            logger.error(
                {...fields, params: req.params, query: req.query, err: res.locals.err},
                message
            )
        } else if (res.statusCode >= 400) {
            logger.warn(
                {...fields, params: req.params, query: req.query, err: res.locals.err},
                message
            )
        } else {
            logger.info(fields, message)
        }
    })

    next()
}

module.exports = requestLogger
