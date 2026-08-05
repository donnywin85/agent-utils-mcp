#!/usr/bin/env node
// agent-utils-mcp — eight paid utilities for AI agents, billed per call in
// USDC on Base mainnet via x402. Prices come from the PRICES table below and
// are checked against the live gateway by `npm run pricecheck`.
//
// The tools were not chosen by guesswork. They are the categories that USDC
// receipts across 1,062 x402 seller wallets showed agents actually pay for:
// geocoding (56 payers), weather (21), article/PDF -> Markdown (7),
// randomness (6), web search (6).
//
// The wallet that pays is YOURS: this server reads EVM_PRIVATE_KEY from its own
// env, set in your MCP client's config. This package ships NO keys.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { createPaidClient } from './x402-client.mjs';

const server = new McpServer({ name: 'agent-utils', version: '0.1.0' });

// Built LAZILY so `listTools` works with no key configured — an agent must be
// able to see what is on offer before it decides to fund a wallet.
let client = null;
const getClient = () => (client ??= createPaidClient());

// ★ ONE TABLE, AND A TEST THAT COMPARES IT TO THE LIVE GATEWAY.
//
//   Every tool description used to end in a hardcoded "Costs $0.01 USDC per
//   call", and the receipt line said "(paid $0.01 USDC …)" no matter what had
//   actually been paid. Both were wrong: these routes cost $0.003, and the
//   gateway introduced a $0.03 compliance tier on 2026-08-05. A price quoted in
//   a tool description is a promise an agent plans against, and a receipt that
//   states an amount nobody charged is simply a false statement.
//
//   So prices live here once, and `npm run pricecheck` fetches the gateway's
//   own /openapi.json and fails if any entry disagrees. The two surfaces cannot
//   drift silently, which is the same rule the gateway applies to its 402s and
//   its discovery document.
export const PRICES = {
  '/geocode': '0.003',
  '/reverse-geocode': '0.003',
  '/weather': '0.003',
  '/search': '0.003',
  '/markdown': '0.003',
  '/random': '0.003',
  '/lei': '0.03',
  '/sanctions': '0.03',
};

const priceLine = (routePath) =>
  `Costs $${PRICES[routePath]} USDC per call on Base mainnet (eip155:8453), paid automatically from the wallet in EVM_PRIVATE_KEY.`;

async function run(routePath, params) {
  try {
    const r = await getClient().call(routePath, params);
    if (r.status !== 200) {
      const detail = typeof r.body === 'string' ? r.body : JSON.stringify(r.body);
      return { isError: true, content: [{ type: 'text', text: `Gateway returned HTTP ${r.status}: ${detail}` }] };
    }
    const payload = typeof r.body === 'string' ? r.body : JSON.stringify(r.body, null, 2);
    // Surface the settle hash so the caller can verify it actually paid rather
    // than take our word for it. The AMOUNT comes from the receipt when the
    // gateway reports one, and falls back to the declared price — never a
    // constant, which is what made the old line untrue.
    const amount = r.amountUsdc ?? PRICES[routePath];
    const proof = r.txHash ? `\n\n(paid $${amount} USDC — settle tx ${r.txHash})` : '';
    return { content: [{ type: 'text', text: payload + proof }] };
  } catch (err) {
    return { isError: true, content: [{ type: 'text', text: `${routePath} failed: ${err?.message || String(err)}` }] };
  }
}

server.registerTool('geocode', {
  title: 'Address or place name to coordinates',
  description:
    'Forward geocoding: turn an address or place name into latitude/longitude. Returns ranked candidates with display name, coordinates, bounding box, address components, and an importance score so you can judge ambiguity rather than assume the first hit is right. Data from OpenStreetMap Nominatim. ' + priceLine('/geocode'),
  inputSchema: {
    q: z.string().describe('Address or place name, e.g. "1600 Amphitheatre Parkway, Mountain View". Max 300 characters.'),
  },
}, ({ q }) => run('/geocode', { q }));

server.registerTool('reverse_geocode', {
  title: 'Coordinates to address',
  description:
    'Reverse geocoding: turn latitude/longitude into a street address with structured components. Returns null with a reason rather than a guess when the point is ocean or unmapped. Data from OpenStreetMap Nominatim. ' + priceLine('/reverse-geocode'),
  inputSchema: {
    lat: z.number().describe('Latitude, -90..90.'),
    lon: z.number().describe('Longitude, -180..180.'),
  },
}, ({ lat, lon }) => run('/reverse-geocode', { lat, lon }));

server.registerTool('weather', {
  title: 'Current conditions and forecast for coordinates',
  description:
    'Weather for any coordinates worldwide: current temperature, feels-like, humidity, precipitation, wind speed, gusts and direction, plus up to a 7-day daily forecast with highs, lows, precipitation totals and probability. Every condition carries both the standard WMO code and plain text. Forecast rows are model output and the response says so. Pair with geocode to go from a place name to coordinates. Data from Open-Meteo. ' + priceLine('/weather'),
  inputSchema: {
    lat: z.number().describe('Latitude, -90..90.'),
    lon: z.number().describe('Longitude, -180..180.'),
    days: z.number().int().min(1).max(7).optional().describe('Forecast days, 1..7. Default 3.'),
  },
}, ({ lat, lon, days }) => run('/weather', { lat, lon, days }));

server.registerTool('web_search', {
  title: 'Free-text web search',
  description:
    'Web search: a free-text query returns ranked organic results with title, real destination URL, display URL and snippet. Sponsored rows are excluded. Results are not fetched or verified — a listing says nothing about whether the page is correct or still live. Pair with url_to_markdown to read any result. ' + priceLine('/search'),
  inputSchema: {
    q: z.string().describe('Search terms. Max 500 characters.'),
    count: z.number().int().min(1).max(25).optional().describe('Maximum results, 1..25. Default 10. A maximum, not a guarantee — rows whose destination cannot be resolved are dropped rather than guessed at.'),
  },
}, ({ q, count }) => run('/search', { q, count }));

server.registerTool('url_to_markdown', {
  title: 'Article or PDF URL to clean Markdown',
  description:
    'Fetch a public article or PDF URL and return clean Markdown, using Firefox reader-mode extraction for HTML and text extraction for PDFs. Returns title, byline, excerpt, word count and a truncation flag. JavaScript is not executed, so client-rendered pages return an explicit not_extractable error rather than an empty page passed off as the article. Private, loopback and cloud-metadata addresses are refused. ' + priceLine('/markdown'),
  inputSchema: {
    url: z.string().describe('Public http/https URL of an article or PDF.'),
  },
}, ({ url }) => run('/markdown', { url }));

server.registerTool('secure_random', {
  title: 'Cryptographically secure randomness',
  description:
    'Cryptographically secure random values from a CSPRNG: either random bytes (hex and base64url) or uniform integers in an inclusive range. Integers are rejection-sampled, so the distribution is uniform rather than modulo-biased. For randomness nobody else could have seen, generate it yourself — this is for callers that cannot. ' + priceLine('/random'),
  inputSchema: {
    bytes: z.number().int().min(1).max(1024).optional().describe('Number of random bytes, 1..1024. Default 32. Ignored when min/max are given.'),
    min: z.number().int().optional().describe('Inclusive lower bound for integer mode. Requires max.'),
    max: z.number().int().optional().describe('Inclusive upper bound for integer mode. Requires min.'),
    count: z.number().int().min(1).max(1000).optional().describe('How many integers to draw, 1..1000. Default 1.'),
  },
}, ({ bytes, min, max, count }) => run('/random', { bytes, min, max, count }));

// ★ The two compliance tools, added 2026-08-05 BEFORE the experiment clock
//   starts (see EXPERIMENT-mcp-distribution in x402-gateway, "Amendment").
//   Measured across the whole CDP Bazaar that day, the sellers paid by many
//   distinct wallets sell compliance-shaped data — greeneris takes $0.037/call
//   from 15 wallets for the same GLEIF copy our /lei reads. Distributing only
//   the commodity tools would have tested the channel using the products we
//   already have evidence nobody pays for, and answered the wrong question.

server.registerTool('sanctions_screen', {
  title: 'Screen a name against OFAC sanctions lists',
  description:
    'OFAC sanctions screening. Checks a person or company against the US Treasury SDN and Consolidated lists — 19,600+ designated parties and 40,000+ names including every alias — and returns the matched record with its sanctions programs, designation remarks and a match score. Word order does not matter, because OFAC stores people as "SURNAME, Given". riskLevel is hit, possible or clear, and "clear" is scoped to the lists named in the response: EU, UK and UN are NOT screened. If the lists cannot be loaded you get an error, never a clear — a screening tool that says "no match" when it has no list is worse than one that is down. ' + priceLine('/sanctions'),
  inputSchema: {
    name: z.string().describe('Person or company name to screen. Max 200 characters. Word order does not matter.'),
    minScore: z.number().min(0.1).max(1).optional().describe('Match threshold 0.1..1. Default 0.6; 1.0 is an exact name-token match.'),
    type: z.enum(['individual', 'entity', 'vessel', 'aircraft']).optional().describe('Restrict to one designation type.'),
    limit: z.number().int().min(1).max(50).optional().describe('Maximum matches returned, 1..50. Default 10.'),
  },
}, ({ name, minScore, type, limit }) => run('/sanctions', { name, minScore, type, limit }));

server.registerTool('lei_lookup', {
  title: 'Legal Entity Identifier lookup by company name',
  description:
    'Legal Entity Identifier (LEI) lookup from the GLEIF golden copy. Search by company NAME, not just by identifier — knowing the LEI already is the hard part. Returns the LEI, registered legal name, previous names, legal form, jurisdiction, legal and headquarters addresses, and the registration record. LAPSED, RETIRED and ANNULLED entities are returned with a lapsed flag rather than hidden, because a filtered record and no record look identical to a caller. ' + priceLine('/lei'),
  inputSchema: {
    q: z.string().describe('Legal entity name, max 200 chars. Include the suffix for a precise match, e.g. "Apple Inc." rather than "Apple".'),
    lei: z.string().optional().describe('Exact 20-character LEI for a single record. Use instead of q.'),
    limit: z.number().int().min(1).max(50).optional().describe('Maximum name-search results, 1..50. Default 10.'),
  },
}, ({ q, lei, limit }) => run('/lei', { q, lei, limit }));

const transport = new StdioServerTransport();
await server.connect(transport);
