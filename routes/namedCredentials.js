const express = require("express")
const crypto = require("crypto")
const fs = require("fs")
const path = require("path")
const jwt = require("jsonwebtoken")

const router = express.Router()

// ── Config (Named Credentials practice — SF callouts → this server) ─────────
const BASIC_USERNAME = process.env.NC_BASIC_USERNAME || "nc-basic-user"
const BASIC_PASSWORD = process.env.NC_BASIC_PASSWORD || "nc-basic-pass"

const CUSTOM_HEADER_NAME = (process.env.NC_CUSTOM_HEADER_NAME || "X-API-KEY").toLowerCase()
const CUSTOM_HEADER_VALUE = process.env.NC_CUSTOM_HEADER_VALUE || process.env.API_KEY || "sf-practice-key-12345"

const JWT_AUDIENCE = process.env.NC_JWT_AUDIENCE || ""
const JWT_ISSUER = process.env.NC_JWT_ISSUER || ""
const JWT_CERT_DIR = process.env.SF_CERT_DIR || "certs"
const JWT_PUBLIC_CERT = process.env.NC_JWT_PUBLIC_CERT || "sf-jwt-public.crt"
const JWT_CLOCK_SKEW_S = parseInt(process.env.NC_JWT_CLOCK_SKEW_SEC ?? "60", 10)

const TOKEN_TTL_SEC = parseInt(process.env.TOKEN_TTL_SEC ?? "3600", 10)

// In-memory tokens issued by JWT Token Exchange (practice only).
const exchangeTokenStore = new Map()

function safeEqual(a, b) {
    const bufA = Buffer.from(String(a))
    const bufB = Buffer.from(String(b))
    if (bufA.length !== bufB.length) {
        crypto.timingSafeEqual(bufA, bufA)
        return false
    }
    return crypto.timingSafeEqual(bufA, bufB)
}

function loadJwtVerifyKeys() {
    const certDir = path.join(__dirname, "..", JWT_CERT_DIR)
    const keys = []

    const sfPublicPath = path.join(certDir, JWT_PUBLIC_CERT)
    if (fs.existsSync(sfPublicPath)) {
        keys.push({
            label: JWT_PUBLIC_CERT,
            key: fs.readFileSync(sfPublicPath, "utf8"),
        })
    }

    // Local practice cert — use for curl tests before Salesforce is configured.
    const localCrt = path.join(certDir, "server.crt")
    if (fs.existsSync(localCrt)) {
        keys.push({
            label: "server.crt",
            key: fs.readFileSync(localCrt, "utf8"),
        })
    }

    return keys
}

function verifyIncomingJwt(token) {
    const keys = loadJwtVerifyKeys()
    if (keys.length === 0) {
        const err = new Error(
            `No JWT public cert found. Place Salesforce cert at certs/${JWT_PUBLIC_CERT} ` +
                "(or keep certs/server.crt for local curl practice)."
        )
        err.code = "NO_CERT"
        throw err
    }

    const verifyOptions = {
        algorithms: ["RS256"],
        clockTolerance: JWT_CLOCK_SKEW_S,
    }
    if (JWT_AUDIENCE) verifyOptions.audience = JWT_AUDIENCE
    if (JWT_ISSUER) verifyOptions.issuer = JWT_ISSUER

    let lastError
    for (const {label, key} of keys) {
        try {
            const payload = jwt.verify(token, key, verifyOptions)
            return {payload, verified_with: label}
        } catch (err) {
            lastError = err
        }
    }
    throw lastError
}

function issueExchangeToken() {
    const token = crypto.randomBytes(32).toString("hex")
    exchangeTokenStore.set(token, Date.now() + TOKEN_TTL_SEC * 1000)
    return token
}

function pruneExchangeTokens() {
    const now = Date.now()
    for (const [token, exp] of exchangeTokenStore) {
        if (exp < now) exchangeTokenStore.delete(token)
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. BASIC AUTHENTICATION
// Salesforce Named Credential / External Credential → Authentication Protocol: Basic
// SF sends: Authorization: Basic base64(username:password)
// ═══════════════════════════════════════════════════════════════════════════
function basicGuard(req, res, next) {
    const authHeader = req.headers["authorization"] ?? ""

    if (!authHeader.startsWith("Basic ")) {
        return res.status(401).set("WWW-Authenticate", 'Basic realm="Named Credentials Practice"').json({
            auth_type: "Basic Authentication",
            error: "Unauthorized",
            reason: "Missing Authorization: Basic <credentials> header.",
            hint: "In Salesforce External Credential, set Authentication Protocol = Basic Authentication.",
        })
    }

    let decoded
    try {
        decoded = Buffer.from(authHeader.slice(6), "base64").toString("utf8")
    } catch {
        return res.status(401).json({
            auth_type: "Basic Authentication",
            error: "Unauthorized",
            reason: "Could not base64-decode Basic credentials.",
        })
    }

    const colon = decoded.indexOf(":")
    const username = colon === -1 ? decoded : decoded.slice(0, colon)
    const password = colon === -1 ? "" : decoded.slice(colon + 1)

    if (!safeEqual(username, BASIC_USERNAME) || !safeEqual(password, BASIC_PASSWORD)) {
        return res.status(401).json({
            auth_type: "Basic Authentication",
            error: "Unauthorized",
            reason: "Invalid username or password.",
            hint: `Expected username="${BASIC_USERNAME}". Match NC_BASIC_USERNAME / NC_BASIC_PASSWORD in .env.`,
        })
    }

    req.ncAuth = {type: "basic", username}
    next()
}

router.get("/api/nc/basic/orders", basicGuard, (req, res) => {
    res.json({
        auth_type: "Basic Authentication",
        authenticated_as: req.ncAuth.username,
        orders: [
            {
                id: "o-1001",
                account: "Acme Corp",
                status: "Shipped",
                total: 1299.0,
            },
            {
                id: "o-1002",
                account: "Globex Inc",
                status: "Processing",
                total: 450.5,
            },
        ],
        salesforce_setup: [
            "Create External Credential → Authentication Protocol: Basic Authentication.",
            `Principal: username=${BASIC_USERNAME}, password=<NC_BASIC_PASSWORD>.`,
            "Create Named Credential pointing at this server; allow Formula-based endpoints if needed.",
            "Apex: req.setEndpoint('callout:YourNamedCred/api/nc/basic/orders');",
        ],
    })
})

// ═══════════════════════════════════════════════════════════════════════════
// 2. CUSTOM AUTHENTICATION
// Salesforce External Credential → Authentication Protocol: Custom
// SF sends whatever custom headers / query params you map (API key, HMAC, etc.)
// ═══════════════════════════════════════════════════════════════════════════
function customGuard(req, res, next) {
    const provided = req.headers[CUSTOM_HEADER_NAME]

    if (!provided) {
        return res.status(401).json({
            auth_type: "Custom Authentication",
            error: "Unauthorized",
            reason: `Missing custom header "${CUSTOM_HEADER_NAME}".`,
            hint: "In External Credential (Custom), map a custom header to this name and value.",
        })
    }

    if (!safeEqual(provided, CUSTOM_HEADER_VALUE)) {
        return res.status(401).json({
            auth_type: "Custom Authentication",
            error: "Unauthorized",
            reason: "Custom header value is invalid.",
            provided_length: String(provided).length,
            hint: "Header value must match NC_CUSTOM_HEADER_VALUE (or API_KEY) in .env.",
        })
    }

    req.ncAuth = {type: "custom", header: CUSTOM_HEADER_NAME}
    next()
}

router.get("/api/nc/custom/inventory", customGuard, (req, res) => {
    res.json({
        auth_type: "Custom Authentication",
        authenticated_via: req.ncAuth.header,
        inventory: [
            {sku: "SKU-A1", name: "Widget", qty: 120},
            {sku: "SKU-B2", name: "Gadget", qty: 45},
            {sku: "SKU-C3", name: "Doohickey", qty: 8},
        ],
        salesforce_setup: [
            "Create External Credential → Authentication Protocol: Custom.",
            `Add custom header: ${CUSTOM_HEADER_NAME} = ${CUSTOM_HEADER_VALUE}`,
            "Create Named Credential → URL = this server base URL.",
            "Apex: req.setEndpoint('callout:YourNamedCred/api/nc/custom/inventory');",
            "Also works with Legacy Named Credentials custom headers (see /api/v1/secure-data).",
        ],
    })
})

// ═══════════════════════════════════════════════════════════════════════════
// 3. JWT (direct Bearer JWT)
// Salesforce External Credential → Authentication Protocol: JWT
// SF signs a JWT (RS256) with a certificate and sends:
//   Authorization: Bearer <jwt>
// ═══════════════════════════════════════════════════════════════════════════
function jwtBearerGuard(req, res, next) {
    const authHeader = req.headers["authorization"] ?? ""
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : null

    if (!token) {
        return res.status(401).json({
            auth_type: "JWT",
            error: "Unauthorized",
            reason: "Missing Authorization: Bearer <jwt> header.",
            hint: "External Credential protocol = JWT. SF injects the signed JWT as Bearer.",
        })
    }

    try {
        const {payload, verified_with} = verifyIncomingJwt(token)
        req.ncAuth = {type: "jwt", payload, verified_with}
        return next()
    } catch (err) {
        if (err.code === "NO_CERT") {
            return res.status(503).json({
                auth_type: "JWT",
                error: "Server misconfigured",
                reason: err.message,
            })
        }
        return res.status(401).json({
            auth_type: "JWT",
            error: "invalid_token",
            reason: err.message,
            hint: [
                "Export the public cert from Salesforce Certificates & Key Management",
                `and save it as certs/${JWT_PUBLIC_CERT}.`,
                JWT_AUDIENCE
                    ? `Expected aud="${JWT_AUDIENCE}" (NC_JWT_AUDIENCE).`
                    : "Set NC_JWT_AUDIENCE to enforce aud.",
                JWT_ISSUER ? `Expected iss="${JWT_ISSUER}" (NC_JWT_ISSUER).` : "Set NC_JWT_ISSUER to enforce iss.",
            ].join(" "),
        })
    }
}

router.get("/api/nc/jwt/accounts", jwtBearerGuard, (req, res) => {
    res.json({
        auth_type: "JWT",
        verified_with: req.ncAuth.verified_with,
        claims: {
            iss: req.ncAuth.payload.iss,
            sub: req.ncAuth.payload.sub,
            aud: req.ncAuth.payload.aud,
            exp: req.ncAuth.payload.exp,
        },
        accounts: [
            {
                id: "001xx",
                name: "Northern Trail Outfitters",
                industry: "Retail",
            },
            {id: "001yy", name: "Edge Communications", industry: "Telecom"},
        ],
        salesforce_setup: [
            "Create a self-signed certificate in Setup → Certificate and Key Management.",
            "Create External Credential → Authentication Protocol: JWT.",
            "Set Signing Certificate to that cert; configure iss / sub / aud claims.",
            `aud should match NC_JWT_AUDIENCE (e.g. your public base URL).`,
            `Download the cert (.crt) into this repo as certs/${JWT_PUBLIC_CERT}.`,
            "Named Credential URL = this server; callout path /api/nc/jwt/accounts.",
        ],
    })
})

// Optional: mint a practice JWT signed with certs/server.key (local curl only).
// Not used by Salesforce — SF signs with its own private key.
router.post("/api/nc/jwt/mint", (req, res) => {
    const privateKeyPath = path.join(__dirname, "..", JWT_CERT_DIR, "server.key")
    if (!fs.existsSync(privateKeyPath)) {
        return res.status(503).json({
            error: "server.key missing",
            reason: `Expected ${privateKeyPath}`,
        })
    }

    const privateKey = fs.readFileSync(privateKeyPath, "utf8")
    const now = Math.floor(Date.now() / 1000)
    const payload = {
        iss: req.body?.iss || JWT_ISSUER || "sf-practice-local",
        sub: req.body?.sub || "practice-user@example.com",
        aud: req.body?.aud || JWT_AUDIENCE || `${req.protocol}://${req.get("host")}`,
        iat: now,
        exp: now + (req.body?.ttl_sec ? parseInt(req.body.ttl_sec, 10) : 300),
    }

    const token = jwt.sign(payload, privateKey, {algorithm: "RS256"})

    res.json({
        tip: "Local practice only. Salesforce signs with its own cert — use that public .crt for real callouts.",
        token,
        payload,
        test_curl: `curl -H "Authorization: Bearer ${token}" ${req.protocol}://${req.get("host")}/api/nc/jwt/accounts`,
    })
})

// ── JWT Token Exchange (related JWT variant in Named Credentials) ───────────
// SF posts the JWT to a token endpoint; this server returns an access_token.
// Then SF calls the resource with Authorization: Bearer <access_token>.
router.post("/api/nc/jwt-exchange/token", (req, res) => {
    const assertion =
        req.body?.assertion ||
        req.body?.client_assertion ||
        (req.headers["authorization"]?.startsWith("Bearer ") ? req.headers["authorization"].slice(7).trim() : null)

    if (!assertion) {
        return res.status(400).json({
            error: "invalid_request",
            error_description: "Provide JWT as body.assertion (or Authorization: Bearer <jwt>).",
        })
    }

    try {
        verifyIncomingJwt(assertion)
    } catch (err) {
        return res.status(401).json({
            error: "invalid_grant",
            error_description: err.message,
        })
    }

    pruneExchangeTokens()
    const access_token = issueExchangeToken()

    res.json({
        access_token,
        token_type: "Bearer",
        expires_in: TOKEN_TTL_SEC,
    })
})

function exchangeBearerGuard(req, res, next) {
    const authHeader = req.headers["authorization"] ?? ""
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null

    if (!token) {
        return res.status(401).json({
            auth_type: "JWT Token Exchange",
            error: "unauthorized",
            reason: "Missing Authorization: Bearer <access_token>.",
        })
    }

    pruneExchangeTokens()
    if (!exchangeTokenStore.has(token)) {
        return res.status(401).json({
            auth_type: "JWT Token Exchange",
            error: "invalid_token",
            reason: "Token not found or expired. Exchange a JWT at POST /api/nc/jwt-exchange/token first.",
        })
    }

    next()
}

router.get("/api/nc/jwt-exchange/data", exchangeBearerGuard, (req, res) => {
    res.json({
        auth_type: "JWT Token Exchange",
        message: "Access token from JWT exchange is valid.",
        data: [
            {metric: "mrr", value: 42000},
            {metric: "nrr", value: 1.12},
        ],
        salesforce_setup: [
            "External Credential → Authentication Protocol: JWT Token Exchange.",
            `Token Endpoint URL = ${req.protocol}://${req.get("host")}/api/nc/jwt-exchange/token`,
            "Named Credential resource path = /api/nc/jwt-exchange/data",
        ],
    })
})

// ═══════════════════════════════════════════════════════════════════════════
// 4. OAuth 2.0 — implemented in routes/oauth.js
//    POST /oauth/token          (client_credentials)
//    GET  /api/v2/products      (Bearer access_token)
// Alias here so all Named Cred practice paths live under /api/nc/*
// ═══════════════════════════════════════════════════════════════════════════
router.get("/api/nc/oauth/info", (_req, res) => {
    res.json({
        auth_type: "OAuth 2.0",
        note: "Token + resource endpoints live on the shared OAuth routes (Client Credentials).",
        token_endpoint: "POST /oauth/token",
        resource_endpoint: "GET /api/v2/products",
        grant_type: "client_credentials",
        body_fields: {
            grant_type: "client_credentials",
            client_id: process.env.OAUTH_CLIENT_ID || "sf-practice-client",
            client_secret: "(OAUTH_CLIENT_SECRET from .env)",
        },
        salesforce_setup: [
            "Create External Credential → Authentication Protocol: OAuth 2.0.",
            "Authentication Flow Type: Client Credentials with Client Secret Flow (or Client Credentials).",
            "Identity Provider URL / Token Endpoint = https://<host>/oauth/token",
            "Named Credential callout path = /api/v2/products",
            "Store client_id / client_secret on the External Credential principal.",
        ],
    })
})

module.exports = router
