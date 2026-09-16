const express = require('express')
const router = express.Router()
const {logger, setLogLevel, VALID_LEVELS} = require('../logger')

// Protected by the same site-session auth as the rest of the UI (requireAuth
// in server.js) — this path is intentionally not in PUBLIC_PATHS.
router.get('/admin/log-level', (req, res) => {
    res.json({level: logger.level, valid_levels: VALID_LEVELS})
})

router.post('/admin/log-level', (req, res) => {
    const {level} = req.body || {}
    try {
        setLogLevel(level)
        logger.info({level}, 'log level changed')
        res.json({level: logger.level})
    } catch (err) {
        res.status(400).json({error: err.message, valid_levels: VALID_LEVELS})
    }
})

module.exports = router
