#!/usr/bin/env node
// agent-utils-mcp — six general-purpose utilities for AI agents, each paid
// $0.01 USDC per call on Base mainnet via x402.
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

const PRICE = 'Costs $0.01 USDC per call on Base mainnet (eip155:8453), paid automatically from the wallet in EVM_PRIVATE_KEY.';

async function run(routePath, params) {
  try {
    const r = await getClient().call(routePath, params);
    if (r.status !== 200) {
      const detail = typeof r.body === 'string' ? r.body : JSON.stringify(r.body);
      return { isError: true, content: [{ type: 'text', text: `Gateway returned HTTP ${r.status}: ${detail}` }] };
    }
    const payload = typeof r.body === 'string' ? r.body : JSON.stringify(r.body, null, 2);
    // Surface the settle hash so the caller can verify it actually paid rather
    // than take our word for it.
    const proof = r.txHash ? `\n\n(paid $0.01 USDC — settle tx ${r.txHash})` : '';
    return { content: [{ type: 'text', text: payload + proof }] };
  } catch (err) {
    return { isError: true, content: [{ type: 'text', text: `${routePath} failed: ${err?.message || String(err)}` }] };
  }
}

server.registerTool('geocode', {
  title: 'Address or place name to coordinates',
  description:
    'Forward geocoding: turn an address or place name into latitude/longitude. Returns ranked candidates with display name, coordinates, bounding box, address components, and an importance score so you can judge ambiguity rather than assume the first hit is right. Data from OpenStreetMap Nominatim. ' + PRICE,
  inputSchema: {
    q: z.string().describe('Address or place name, e.g. "1600 Amphitheatre Parkway, Mountain View". Max 300 characters.'),
  },
}, ({ q }) => run('/geocode', { q }));

server.registerTool('reverse_geocode', {
  title: 'Coordinates to address',
  description:
    'Reverse geocoding: turn latitude/longitude into a street address with structured components. Returns null with a reason rather than a guess when the point is ocean or unmapped. Data from OpenStreetMap Nominatim. ' + PRICE,
  inputSchema: {
    lat: z.number().describe('Latitude, -90..90.'),
    lon: z.number().describe('Longitude, -180..180.'),
  },
}, ({ lat, lon }) => run('/reverse-geocode', { lat, lon }));

server.registerTool('weather', {
  title: 'Current conditions and forecast for coordinates',
  description:
    'Weather for any coordinates worldwide: current temperature, feels-like, humidity, precipitation, wind speed, gusts and direction, plus up to a 7-day daily forecast with highs, lows, precipitation totals and probability. Every condition carries both the standard WMO code and plain text. Forecast rows are model output and the response says so. Pair with geocode to go from a place name to coordinates. Data from Open-Meteo. ' + PRICE,
  inputSchema: {
    lat: z.number().describe('Latitude, -90..90.'),
    lon: z.number().describe('Longitude, -180..180.'),
    days: z.number().int().min(1).max(7).optional().describe('Forecast days, 1..7. Default 3.'),
  },
}, ({ lat, lon, days }) => run('/weather', { lat, lon, days }));

server.registerTool('web_search', {
  title: 'Free-text web search',
  description:
    'Web search: a free-text query returns ranked organic results with title, real destination URL, display URL and snippet. Sponsored rows are excluded. Results are not fetched or verified — a listing says nothing about whether the page is correct or still live. Pair with url_to_markdown to read any result. ' + PRICE,
  inputSchema: {
    q: z.string().describe('Search terms. Max 500 characters.'),
    count: z.number().int().min(1).max(25).optional().describe('Maximum results, 1..25. Default 10. A maximum, not a guarantee — rows whose destination cannot be resolved are dropped rather than guessed at.'),
  },
}, ({ q, count }) => run('/search', { q, count }));

server.registerTool('url_to_markdown', {
  title: 'Article or PDF URL to clean Markdown',
  description:
    'Fetch a public article or PDF URL and return clean Markdown, using Firefox reader-mode extraction for HTML and text extraction for PDFs. Returns title, byline, excerpt, word count and a truncation flag. JavaScript is not executed, so client-rendered pages return an explicit not_extractable error rather than an empty page passed off as the article. Private, loopback and cloud-metadata addresses are refused. ' + PRICE,
  inputSchema: {
    url: z.string().describe('Public http/https URL of an article or PDF.'),
  },
}, ({ url }) => run('/markdown', { url }));

server.registerTool('secure_random', {
  title: 'Cryptographically secure randomness',
  description:
    'Cryptographically secure random values from a CSPRNG: either random bytes (hex and base64url) or uniform integers in an inclusive range. Integers are rejection-sampled, so the distribution is uniform rather than modulo-biased. For randomness nobody else could have seen, generate it yourself — this is for callers that cannot. ' + PRICE,
  inputSchema: {
    bytes: z.number().int().min(1).max(1024).optional().describe('Number of random bytes, 1..1024. Default 32. Ignored when min/max are given.'),
    min: z.number().int().optional().describe('Inclusive lower bound for integer mode. Requires max.'),
    max: z.number().int().optional().describe('Inclusive upper bound for integer mode. Requires min.'),
    count: z.number().int().min(1).max(1000).optional().describe('How many integers to draw, 1..1000. Default 1.'),
  },
}, ({ bytes, min, max, count }) => run('/random', { bytes, min, max, count }));

const transport = new StdioServerTransport();
await server.connect(transport);
