const pino = require('pino')

// Pino writes newline-delimited JSON straight to stdout by default —
// exactly what a process manager / system logger (pm2, journald, Docker) wants to capture.
const VALID_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']

// pino's default err serializer copies over every enumerable property of the
// error. Axios errors carry `config`/`request`/`response` with full request
// headers, cookies, and bodies — logging those verbatim risks leaking
// credentials (Authorization headers, session cookies, API keys) into stdout.
// Keep only the safe, useful bits: type, message, stack, and (for HTTP
// client errors) the upstream status code.
function serializeErr(err) {
    if (!err) return err
    return {
        type: err.name,
        message: err.message,
        stack: err.stack,
        upstreamStatus: err.response?.status,
    }
}

const logger = pino({
    level: process.env.LOG_LEVEL || 'info',
    timestamp: pino.stdTimeFunctions.isoTime,
    serializers: {err: serializeErr},
})

// Pino lets you reassign `.level` on a live logger — no restart needed.
// Call this from an admin route (see routes/admin.js) or anywhere else at runtime.
function setLogLevel(level) {
    if (!VALID_LEVELS.includes(level)) {
        throw new Error(`Invalid log level "${level}". Valid levels: ${VALID_LEVELS.join(', ')}`)
    }
    logger.level = level
}

module.exports = {logger, setLogLevel, VALID_LEVELS}
