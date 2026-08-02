// live-call-test.mjs — INTERNAL, machine-local. NOT part of the npm package
// (excluded by the "files" whitelist in package.json).
//
// Spawns the real MCP server over stdio and calls ONE tool for real, exercising
// the whole paid path: MCP -> x402 buyer -> gateway paywall -> agent-utils
// upstream -> on-chain settle. Listing tools proves nothing about whether a
// payment can actually clear.
//
// THIS SPENDS REAL MONEY ($0.01 USDC on Base) from the throwaway key in
// test/.env (gitignored). It is a self-payment to our own gateway and is NOT
// organic demand — on a clean settle it appends a self-primed marker to
// x402-gateway/x402-self-primed.jsonl.
//
// ★ The marker records `buyer`. scripts/demand-funnel.cjs builds its
// exclusion set from that field, so a marker without it leaves a self-payment
// counted as a customer — which is exactly the error that made an internal
// wallet look like our best customer with 74 payments.
//
// Run:  node test/live-call-test.mjs [toolName]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { privateKeyToAccount } from 'viem/accounts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SIDECAR = path.resolve(ROOT, '..', 'x402-gateway', 'x402-self-primed.jsonl');
const GATEWAY = (process.env.GATEWAY_URL || 'https://x402.donnyautomation.com').replace(/\/$/, '');

// Cheapest possible proof: /random is fully offline upstream, so a failure can
// only be the payment path — never someone else's API having a bad minute.
const CASES = {
  secure_random: { args: { bytes: 8 }, route: '/random?bytes=8', expect: (t) => /"hex":\s*"[0-9a-f]{16}"/.test(t) },
  geocode: { args: { q: 'Eiffel Tower Paris' }, route: '/geocode', expect: (t) => /"lat"/.test(t) },
  weather: { args: { lat: 40.7128, lon: -74.006, days: 1 }, route: '/weather', expect: (t) => /"tempC"/.test(t) },
  web_search: { args: { q: 'x402 protocol', count: 3 }, route: '/search', expect: (t) => /"url":\s*"https?:/.test(t) },
};
const TOOL = process.argv[2] || 'secure_random';
if (!CASES[TOOL]) { console.error(`unknown tool "${TOOL}". one of: ${Object.keys(CASES).join(', ')}`); process.exit(1); }

function loadEnv(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}
const env = loadEnv(path.join(__dirname, '.env'));
const KEY = env.EVM_PRIVATE_KEY || process.env.EVM_PRIVATE_KEY;
if (!KEY) { console.error('No EVM_PRIVATE_KEY in test/.env — cannot run the live paid test.'); process.exit(1); }
const buyer = privateKeyToAccount(KEY.startsWith('0x') ? KEY : `0x${KEY}`).address;

function assert(cond, msg) {
  if (!cond) { console.error('  x ASSERT FAILED:', msg); process.exitCode = 1; throw new Error(msg); }
  console.log('  ok', msg);
}
const getStats = async () => {
  try { const r = await fetch(`${GATEWAY}/stats?format=json`, { headers: { 'x-x402-self': '1' } }); return r.ok ? await r.json() : null; }
  catch { return null; }
};

const line = '-'.repeat(66);
console.log(line);
console.log(`  LIVE PAID TEST — tool ${TOOL} — spends $0.01 USDC`);
console.log(`  buyer ${buyer}`);
console.log(line);

const before = await getStats();
console.log('  /stats before:', before ? JSON.stringify(before) : '(unavailable)');

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(ROOT, 'src', 'index.mjs')],
  env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, EVM_PRIVATE_KEY: KEY, GATEWAY_URL: GATEWAY },
});
const client = new Client({ name: 'live-call-test', version: '1.0.0' });
let txHash = null;
try {
  await client.connect(transport);
  const res = await client.callTool({ name: TOOL, arguments: CASES[TOOL].args });
  const text = (res.content || []).map((c) => c.text || '').join('\n');
  assert(!res.isError, `tool ${TOOL} returned without error`);
  assert(CASES[TOOL].expect(text), 'payload has the expected shape');
  const m = text.match(/settle tx (0x[0-9a-fA-F]{64})/);
  txHash = m ? m[1] : null;
  assert(!!txHash, 'response carries an on-chain settle txHash');
  console.log('  Basescan: https://basescan.org/tx/' + txHash);
} finally {
  await client.close();
}

const after = await getStats();
console.log('  /stats after :', after ? JSON.stringify(after) : '(unavailable)');
if (before && after && typeof before.paidCalls === 'number' && typeof after.paidCalls === 'number') {
  assert(after.paidCalls === before.paidCalls + 1, `/stats paidCalls incremented (${before.paidCalls} -> ${after.paidCalls})`);
}

if (txHash) {
  const marker = {
    ts: new Date().toISOString(),
    kind: 'self-primed',
    note: 'MCP wrapper live self-test (agent-utils-mcp) — self-payment, NOT organic agent demand.',
    via: `agent-utils-mcp/${TOOL}`,
    gateway: GATEWAY,
    network: 'base',
    path: CASES[TOOL].route,
    buyer,                    // <- demand-funnel.cjs reads THIS to exclude us
    txHash,
    basescan: 'https://basescan.org/tx/' + txHash,
  };
  try {
    fs.appendFileSync(SIDECAR, JSON.stringify(marker) + '\n');
    console.log('  self-primed marker appended (buyer recorded) ->', SIDECAR);
  } catch (err) {
    console.error('  ! failed to write self-primed marker:', err && err.message);
  }
}

console.log(line);
console.log(process.exitCode ? '  RESULT: FAIL' : '  RESULT: PASS');
console.log(line);
