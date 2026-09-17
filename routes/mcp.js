const express = require('express');
const crypto  = require('crypto');
const { McpServer }                = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { z }          = require('zod');
const asyncHandler   = require('../middleware/asyncHandler');

const router = express.Router();

const MCP_API_KEY = process.env.MCP_API_KEY || 'mcp-practice-token-xyz789';

function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) {
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

// ── Mock knowledge base ──────────────────────────────────────────────────────
// Stands in for the real 3rd-party case-resolution / RAG server from the
// client project. Deliberately kept as an in-memory mock (no outbound HTTP
// call) so this can be exercised end-to-end before committing to the real
// integration — swap `searchResolutions` for an axios call to the real
// endpoint once you're ready, keeping the same {query, startingPage,
// endingPage, singlePageRecordCount} → {results, pagination} shape so the
// MCP tool below doesn't need to change.
const RESOLUTIONS = [
  {
    id: 'KB-1001',
    title: 'Customer cannot reset password — reset email never arrives',
    summary: 'Reset emails were being caught by the org email allowlist. Add the sender domain to Email Deliverability > Allowlisted Domains, then resend.',
    sourceUrl: 'https://help.internal.example.com/kb/KB-1001',
    tags: ['password', 'reset', 'email', 'deliverability', 'login'],
  },
  {
    id: 'KB-1002',
    title: 'Duplicate Lead records created from web-to-lead form',
    summary: 'Web-to-lead was missing a duplicate rule on Email. Add a Matching Rule + Duplicate Rule scoped to Leads, set action to "Block" on exact email match.',
    sourceUrl: 'https://help.internal.example.com/kb/KB-1002',
    tags: ['duplicate', 'lead', 'web-to-lead', 'matching rule'],
  },
  {
    id: 'KB-1003',
    title: 'Outbound emails from Salesforce marked as spam',
    summary: 'SPF/DKIM records were not published for the email relay domain. Publish SPF/DKIM in DNS and enable "Enhanced Email" deliverability checks.',
    sourceUrl: 'https://help.internal.example.com/kb/KB-1003',
    tags: ['email', 'spam', 'deliverability', 'spf', 'dkim'],
  },
  {
    id: 'KB-1004',
    title: 'Integration user hitting API rate limits during nightly sync',
    summary: 'Nightly batch job made one API call per record. Switch to Bulk API 2.0 or composite batching to cut request volume under the org\'s 24-hour API limit.',
    sourceUrl: 'https://help.internal.example.com/kb/KB-1004',
    tags: ['api', 'rate limit', 'bulk api', 'integration', 'sync'],
  },
  {
    id: 'KB-1005',
    title: 'Named Credential callout fails with 401 after cert rotation',
    summary: 'Salesforce\'s signing certificate was rotated but the External Credential\'s JWT principal still referenced the old cert. Re-map the principal to the new certificate and re-download the public key on the callout target.',
    sourceUrl: 'https://help.internal.example.com/kb/KB-1005',
    tags: ['named credential', 'jwt', 'certificate', '401', 'callout'],
  },
  {
    id: 'KB-1006',
    title: 'Case auto-response rule not firing for Web-originated cases',
    summary: 'The auto-response rule\'s entry criteria checked Case Origin = "Web" but the Web-to-Case form set Origin = "Web Form". Align the entry criteria value with the actual picklist value being set.',
    sourceUrl: 'https://help.internal.example.com/kb/KB-1006',
    tags: ['case', 'auto-response', 'web-to-case', 'entry criteria'],
  },
  {
    id: 'KB-1007',
    title: 'OAuth Client Credentials flow returns invalid_client',
    summary: 'The connected app\'s "Run As" user lacked the API Enabled permission. Grant the integration user API Enabled, or assign a permission set that includes it, then retry the token request.',
    sourceUrl: 'https://help.internal.example.com/kb/KB-1007',
    tags: ['oauth', 'client credentials', 'invalid_client', 'permission'],
  },
  {
    id: 'KB-1008',
    title: 'Email-to-Case attachments missing from created Case',
    summary: 'Attachment size exceeded the Email-to-Case 25MB limit and was silently dropped. Enable "Insert attachment errors as case comments" so failures are visible, and route large attachments through a link instead.',
    sourceUrl: 'https://help.internal.example.com/kb/KB-1008',
    tags: ['email', 'case', 'attachment', 'email-to-case'],
  },
  {
    id: 'KB-1009',
    title: 'Flow fails silently when calling an external API via HTTP Callout',
    summary: 'The Flow\'s HTTP Callout action had no fault path connected, so failed callouts just stopped the Flow with no record of why. Add a fault connector and log the response body to a custom object for troubleshooting.',
    sourceUrl: 'https://help.internal.example.com/kb/KB-1009',
    tags: ['flow', 'callout', 'api', 'error handling'],
  },
  {
    id: 'KB-1010',
    title: 'Password reset link expires before customer clicks it',
    summary: 'Session Settings had "Forgot Password" link expiration set to 15 minutes, too short for customers checking email later. Increase the expiration window in Setup > Session Settings.',
    sourceUrl: 'https://help.internal.example.com/kb/KB-1010',
    tags: ['password', 'reset', 'session', 'expiration', 'login'],
  },
  {
    id: 'KB-1011',
    title: 'Named Credential merge field returns blank in Apex callout',
    summary: 'The Named Credential URL used a merge field that wasn\'t populated on the calling record. Verify the merge field API name and that the field is accessible to the running user.',
    sourceUrl: 'https://help.internal.example.com/kb/KB-1011',
    tags: ['named credential', 'callout', 'apex', 'merge field'],
  },
  {
    id: 'KB-1012',
    title: 'Bulk API job stuck in "Queued" state for hours',
    summary: 'Org had hit its concurrent Bulk API job limit from an unrelated integration. Check Bulk Data Load Jobs in Setup and stagger job submission, or request a limit increase from Salesforce.',
    sourceUrl: 'https://help.internal.example.com/kb/KB-1012',
    tags: ['bulk api', 'integration', 'rate limit', 'sync'],
  },
  {
    id: 'KB-1013',
    title: "UNABLE_TO_LOCK_ROW: Unable to obtain exclusive access to record",
    summary: "An enterprise customer user and background integration job encountered the UNABLE_TO_LOCK_ROW exception when attempting to update child records concurrently during peak business hours. The issue occurred because multiple parallel execution threads (Apex triggers and automated workflows) attempted to lock and update the same parent Account record simultaneously, exceeding the database wait timeout.",
    sourceUrl: "[https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_transaction_locking.htm](https://www.google.com/search?q=https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_transaction_locking.htm)",
    tags: [
        "salesforce",
        "unable-to-lock-row",
        "record-locking",
        "concurrency",
        "apex",
        "bulk-api",
        "troubleshooting"
     ]
  }
];

function searchResolutions({ query, startingPage = 1, endingPage = 1, singlePageRecordCount = 5, baseUrl = '' }) {
  const terms = String(query || '')
    .toLowerCase()
    .split(/\W+/)
    .filter(Boolean);

  const scored = RESOLUTIONS.map((r) => {
    const haystack = `${r.title} ${r.summary} ${r.tags.join(' ')}`.toLowerCase();
    const score = terms.reduce((acc, term) => acc + (haystack.includes(term) ? 1 : 0), 0);
    return { r, score };
  }).filter(({ score }) => score > 0);

  scored.sort((a, b) => b.score - a.score);

  // Pagination mirrors the real 3rd-party server's contract:
  //   startingPage            -> starting-page  (send data from this page)
  //   endingPage              -> ending-page     (send data through this page, inclusive)
  //   singlePageRecordCount   -> single-page-record-count (records per page)
  const pageSize = Math.max(1, singlePageRecordCount);
  const totalRecords = scored.length;
  const totalPages = Math.max(1, Math.ceil(totalRecords / pageSize));

  const clampedStart = Math.min(Math.max(1, startingPage), totalPages);
  const clampedEnd = Math.min(Math.max(clampedStart, endingPage), totalPages);

  const sliceStart = (clampedStart - 1) * pageSize;
  const sliceEnd = clampedEnd * pageSize;

  const results = scored.slice(sliceStart, sliceEnd).map(({ r, score }) => ({
    id: r.id,
    title: r.title,
    summary: r.summary,
    sourceUrl: r.sourceUrl,
    relevanceScore: score,
    imageUrl: `${baseUrl}/api/kb/images/${r.id}`,
  }));

  return {
    results,
    pagination: {
      startingPage: clampedStart,
      endingPage: clampedEnd,
      singlePageRecordCount: pageSize,
      totalRecords,
      totalPages,
    },
  };
}

// ── Mock images ──────────────────────────────────────────────────────────────
// Real KB/RAG servers usually attach a screenshot or diagram to each
// resolution. Generates a small placeholder SVG per resolution (no binary
// asset pipeline needed for practice) so both "image URL" and "inline
// base64" delivery can be exercised.
function escapeXml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
}

function buildPlaceholderSvg(resolution) {
  const bg = `#${crypto.createHash('md5').update(resolution.id).digest('hex').slice(0, 6)}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="270">
  <rect width="100%" height="100%" fill="${bg}"/>
  <text x="24" y="140" font-family="sans-serif" font-size="22" fill="#ffffff">${escapeXml(resolution.id)}</text>
  <text x="24" y="172" font-family="sans-serif" font-size="14" fill="#ffffff">${escapeXml(resolution.title)}</text>
</svg>`;
}

// Public (no auth) — mimics a real KB server hosting article screenshots at
// a plain URL. Referenced by imageUrl in search results and added as a
// prefix in server.js's PUBLIC_PATH_PREFIXES (path has a dynamic :id).
router.get('/api/kb/images/:id', (req, res) => {
  const resolution = RESOLUTIONS.find((r) => r.id === req.params.id);
  if (!resolution) {
    return res.status(404).json({ error: 'Not Found', hint: 'No resolution with that id.' });
  }
  res.set('Content-Type', 'image/svg+xml');
  res.send(buildPlaceholderSvg(resolution));
});

// ── Custom-header guard (checked inside the tool, not as route middleware) ──
// initialize/tools/list reach the server unauthenticated — MCP has no notion
// of "login" at the protocol layer, so there's nothing to gate before a tool
// actually runs. Auth is enforced at the point where it matters: the tool
// handler reads the raw request header via `extra.requestInfo.headers`
// (populated by StreamableHTTPServerTransport per-request) and throws if it's
// missing/wrong. The SDK catches thrown errors from a tool callback and turns
// them into a normal CallToolResult with isError: true — no HTTP-level 401,
// the JSON-RPC call itself still "succeeds" but reports a tool-level failure.
function checkMcpAuth(headers) {
  const provided = headers?.['x-mcp-api-key'];

  if (!provided) {
    throw new Error('Missing X-MCP-API-KEY header. Configure your MCP client to send X-MCP-API-KEY: <MCP_API_KEY>.');
  }

  if (!safeEqual(provided, MCP_API_KEY)) {
    throw new Error('X-MCP-API-KEY header is invalid. Value must match MCP_API_KEY in .env.');
  }
}

// ── MCP server ───────────────────────────────────────────────────────────────
// One tool: search_case_resolutions. Built fresh per request (stateless
// Streamable HTTP — sessionIdGenerator: undefined) since this tool is a
// single read-only lookup with no need for multi-turn session state.
// `baseUrl` is threaded through so imageUrl in results is absolute.
function buildMcpServer(baseUrl) {
  const server = new McpServer({ name: 'sf-integration-practice-kb', version: '1.0.0' });

  server.registerTool(
    'search_case_resolutions',
    {
      title: 'Search case resolutions',
      description: 'Search a knowledge base of past support-case resolutions by free-text query. Returns the closest matches (each with an id, a sourceUrl, and an imageUrl), paginated the same way the real 3rd-party KB server paginates.',
      inputSchema: {
        query: z.string().describe('Free-text description of the case/problem to find similar resolutions for.'),
        startingPage: z.number().int().min(1).optional().describe('First page of ranked results to return (1-indexed). Maps to the real server\'s "starting-page". Default 1.'),
        endingPage: z.number().int().min(1).optional().describe('Last page of ranked results to return (inclusive). Maps to the real server\'s "ending-page". Default = startingPage.'),
        singlePageRecordCount: z.number().int().min(1).max(50).optional().describe('Records per page. Maps to the real server\'s "single-page-record-count". Default 5.'),
        includeImages: z.boolean().optional().describe('If true, also inline each result\'s image as a base64 MCP image content block, in addition to the imageUrl field.'),
      },
      // Declared up front (shows up in tools/list) and enforced at runtime —
      // the SDK validates our returned structuredContent against this and
      // throws a protocol-level error if we ever drift from this shape.
      outputSchema: {
        pagination: z.object({
          startingPage: z.number(),
          endingPage: z.number(),
          singlePageRecordCount: z.number(),
          totalRecords: z.number(),
          totalPages: z.number(),
        }),
        results: z.array(z.object({
          id: z.string(),
          title: z.string(),
          summary: z.string(),
          sourceUrl: z.string(),
          relevanceScore: z.number(),
          imageUrl: z.string(),
        })),
      },
    },
    async ({ query, startingPage, endingPage, singlePageRecordCount, includeImages }, extra) => {
      checkMcpAuth(extra.requestInfo?.headers);

      const effectiveStart = startingPage ?? 1;
      const { results, pagination } = searchResolutions({
        query,
        startingPage: effectiveStart,
        endingPage: endingPage ?? effectiveStart,
        singlePageRecordCount: singlePageRecordCount ?? 5,
        baseUrl,
      });

      const content = [
        { type: 'text', text: JSON.stringify({ pagination, results }, null, 2) },
      ];

      if (includeImages) {
        for (const result of results) {
          const resolution = RESOLUTIONS.find((r) => r.id === result.id);
          content.push({
            type: 'image',
            data: Buffer.from(buildPlaceholderSvg(resolution)).toString('base64'),
            mimeType: 'image/svg+xml',
          });
        }
      }

      return { content, structuredContent: { pagination, results } };
    }
  );

  return server;
}

// ── Scenario: MCP Server (case-resolution knowledge base tool) ─────────────
// Practice: point an MCP client at this server and call search_case_resolutions.
// initialize and tools/list are unauthenticated (nothing to check them against —
// see checkMcpAuth above); the X-MCP-API-KEY header is only required on the
// actual tools/call for search_case_resolutions.
//
// Test with the MCP Inspector:
//   npx @modelcontextprotocol/inspector
//   Transport: Streamable HTTP, URL: http://localhost:3000/api/mcp
//   (no auth header needed to connect/list tools — add X-MCP-API-KEY when calling the tool)
//
// Or configure Claude Desktop/Code's MCP settings with:
//   { "type": "http", "url": "http://localhost:3000/api/mcp",
//     "headers": { "X-MCP-API-KEY": "<MCP_API_KEY>" } }
//
// Raw curl for the initial handshake (a real client does this automatically):
//   curl -X POST http://localhost:3000/api/mcp \
//     -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
//     -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}'
//
// Raw curl for a tool call, with the header the tool itself checks:
//   curl -X POST http://localhost:3000/api/mcp \
//     -H "X-MCP-API-KEY: mcp-practice-token-xyz789" \
//     -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
//     -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"search_case_resolutions","arguments":{"query":"password reset"}}}'
router.post('/api/mcp', asyncHandler(async (req, res) => {
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const server = buildMcpServer(baseUrl);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

  res.on('close', () => {
    transport.close();
    server.close();
  });

  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
}));

// Stateless mode has no session to resume (GET) or terminate (DELETE).
router.get('/api/mcp', (req, res) => {
  res.status(405).json({
    error: 'Method Not Allowed',
    hint: 'This MCP endpoint runs in stateless mode — only POST is supported.',
  });
});

router.delete('/api/mcp', (req, res) => {
  res.status(405).json({
    error: 'Method Not Allowed',
    hint: 'This MCP endpoint runs in stateless mode — there is no session to terminate.',
  });
});

module.exports = router;
