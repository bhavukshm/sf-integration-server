const express = require("express");
const router = express.Router();

const VALID_API_KEY = process.env.API_KEY || "sf-practice-key-12345";

// ── Guard middleware ─────────────────────────────────────────────────────────
// Accepts either:
//   X-API-KEY: <key>
//   Authorization: ApiKey <key>
//
// In Legacy Named Credentials, Salesforce forwards the header you configure.
// A 401 here means the credential header was stripped, mistyped, or never set.
function apiKeyGuard(req, res, next) {
    const fromXHeader = req.headers["x-api-key"];
    const authHeader = req.headers["authorization"] ?? "";
    const fromAuth = authHeader.startsWith("ApiKey ")
        ? authHeader.slice(7)
        : null;
    const provided = fromXHeader || fromAuth;

    if (!provided) {
        return res.status(401).json({
            error: "Unauthorized",
            reason: "No authentication header found.",
            hint: "Send X-API-KEY: <key>  or  Authorization: ApiKey <key>",
        });
    }

    if (provided !== VALID_API_KEY) {
        return res.status(401).json({
            error: "Unauthorized",
            reason: "API key is invalid.",
            provided_key_length: provided.length,
            hint: "Check the key configured in your Named Credential matches API_KEY env var.",
        });
    }

    next();
}

// ── Scenario 3: Legacy Named Credentials ────────────────────────────────────
// Practice: configure a Legacy Named Credential with a custom header.
// Common failure modes surfaced by the 401 responses above:
//   - Header name mismatch (e.g. "Api-Key" vs "X-API-KEY")
//   - Credential not merged — Salesforce strips the header in certain org settings
//   - Wrong endpoint URL → 404 masks the auth problem entirely
router.get("/api/v1/secure-data", apiKeyGuard, (req, res) => {
    const via = req.headers["x-api-key"]
        ? "X-API-KEY"
        : "Authorization: ApiKey";

    res.json({
        scenario: "Scenario 3 — Legacy Named Credentials",
        authenticated_via: via,
        records: [
            { id: "a01", name: "Acme Corp", tier: "Gold" },
            { id: "a02", name: "Globex Inc", tier: "Silver" },
            { id: "a03", name: "Initech", tier: "Bronze" },
        ],
        tip: "Success means the Named Credential forwarded its header correctly.",
    });
});

module.exports = router;
