// Spawns the real server over stdio and asserts every tool is listed, its
// schema is well-formed, and — critically — that listing works with NO key set.
//
// That last point is the one worth testing: an agent has to be able to see what
// is on offer before it decides to fund a wallet. If the client were built
// eagerly, the server would die at startup with a missing-key error and appear
// broken rather than unconfigured.
//
// No network, no payment, no key. Safe to run anywhere.

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const EXPECTED = ['geocode', 'reverse_geocode', 'weather', 'web_search', 'url_to_markdown', 'secure_random'];

let failures = 0;
const check = (name, pass, detail = '') => {
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  if (!pass) failures += 1;
};

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(ROOT, 'src', 'index.mjs')],
  // Deliberately NO EVM_PRIVATE_KEY.
  env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot },
});

const client = new Client({ name: 'list-tools-test', version: '1.0.0' });
await client.connect(transport);
check('server starts and handshakes with NO key configured', true);

const { tools } = await client.listTools();
check('tool count', tools.length === EXPECTED.length, `${tools.length} tools`);

for (const name of EXPECTED) {
  const t = tools.find((x) => x.name === name);
  check(`tool ${name} present`, !!t);
  if (!t) continue;
  check(`  ${name} has a description`, typeof t.description === 'string' && t.description.length > 40);
  check(`  ${name} states the price`, /\$0\.01 USDC/.test(t.description || ''));
  check(`  ${name} has an input schema`, !!t.inputSchema && typeof t.inputSchema === 'object');
}

// A paid call with no key must fail with an ACTIONABLE message, not a stack
// trace — this is the first thing a misconfigured user sees.
const res = await client.callTool({ name: 'geocode', arguments: { q: 'Paris' } });
const text = (res.content || []).map((c) => c.text || '').join(' ');
check('unconfigured paid call errors cleanly', res.isError === true, `isError=${res.isError}`);
check('  error names EVM_PRIVATE_KEY', /EVM_PRIVATE_KEY/.test(text));
check('  error warns to use a disposable wallet', /disposable|low-balance/i.test(text));

await client.close();
console.log(failures ? `\n${failures} check(s) FAILED` : '\nall tool-listing checks pass');
process.exit(failures ? 1 : 0);
