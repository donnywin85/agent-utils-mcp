// packaging-test.mjs — the three places this package states its identity must
// agree, and the tarball must not ship a key.
//
// WHY. `dex-data-mcp` shipped with `serverInfo: '1.5.0'` while npm said 1.5.1,
// caught only by dry-running a publish. The MCP registry PINS an exact version,
// so a mismatch means the registry advertises a build that does not exist, or
// installs one whose self-reported version is a lie. Three files, one number.
//
// The second half matters more: this package's entire safety story is "the
// wallet is YOURS, we ship no keys". That is a claim about the tarball, so it
// is asserted against the tarball rather than trusted.
//
// No network. Safe in CI.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let failures = 0;
const check = (name, pass, detail = '') => {
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
  if (!pass) failures += 1;
};

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const srv = JSON.parse(fs.readFileSync(path.join(ROOT, 'server.json'), 'utf8'));
const src = fs.readFileSync(path.join(ROOT, 'src', 'index.mjs'), 'utf8');
const srcVersion = (src.match(/new McpServer\(\{[^}]*version: '([^']+)'/) || [])[1];

const versions = {
  'package.json': pkg.version,
  'server.json': srv.version,
  'server.json packages[0]': srv.packages?.[0]?.version,
  'McpServer(version)': srcVersion,
};
check('all four version fields agree', new Set(Object.values(versions)).size === 1, JSON.stringify(versions));

// The registry keys the listing on this name; npm keys the install on the
// identifier. If they disagree the listing points at the wrong package.
check('package.json mcpName matches server.json name',
  pkg.mcpName === srv.name, `${pkg.mcpName} vs ${srv.name}`);
check('server.json npm identifier matches package name',
  srv.packages?.[0]?.identifier === pkg.name, `${srv.packages?.[0]?.identifier} vs ${pkg.name}`);
check('the MCP name uses the verified DNS namespace',
  typeof srv.name === 'string' && srv.name.startsWith('com.donnyautomation/'), srv.name);

// --- the tarball ------------------------------------------------------------
const out = execFileSync('npm', ['pack', '--dry-run', '--json'], { cwd: ROOT, encoding: 'utf8' });
const files = (JSON.parse(out)[0]?.files || []).map((f) => f.path);
check('the tarball is not empty', files.length > 0, `${files.length} files`);
check('src/index.mjs ships', files.includes('src/index.mjs'));
check('src/x402-client.mjs ships', files.includes('src/x402-client.mjs'));

// ★ The safety claim, asserted. `.env` matches nothing here today, but `files`
//   is a whitelist someone will widen one day, and a shipped key is not a bug
//   you can take back once it is on npm.
const leaked = files.filter((f) => /(^|\/)\.env$|\.env\.local$|(^|\/)\.npmrc$|(^|\/)id_rsa|\.pem$|\.key$/.test(f));
check('no credential file is in the tarball', leaked.length === 0, leaked.join(', ') || 'none');

// .env.example is a TEMPLATE and must stay one. A real key pasted here would
// ship to every installer.
const examplePath = path.join(ROOT, '.env.example');
if (fs.existsSync(examplePath)) {
  const ex = fs.readFileSync(examplePath, 'utf8');
  const realKey = /0x[0-9a-fA-F]{64}/.test(ex);
  check('.env.example contains no real-looking private key', !realKey,
    realKey ? 'a 32-byte hex value is present — treat it as COMPROMISED and rotate' : 'template only');
}

console.log(failures ? `\n${failures} packaging check(s) FAILED` : '\npackaging is consistent and ships no secrets');
process.exit(failures ? 1 : 0);
