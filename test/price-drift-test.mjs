// price-drift-test.mjs — the prices we advertise must be the prices the gateway
// charges.
//
// WHY THIS EXISTS. Every tool description used to end in a hardcoded
// "Costs $0.01 USDC per call", and the receipt line said "(paid $0.01 USDC …)"
// regardless of what had actually been paid. Both were wrong by more than 3x:
// these routes cost $0.003, and on 2026-08-05 the gateway introduced a $0.03
// compliance tier. Nothing anywhere connected the two numbers.
//
// A price in a tool description is a promise an agent plans against, and a
// receipt stating an amount nobody charged is a false statement. So this fetches
// the gateway's own /openapi.json and fails if any declared price disagrees.
//
// NETWORK-DEPENDENT ON PURPOSE, so it stays OUT of CI: a check that fails
// because someone else's service is down teaches you to ignore it. Run it
// before publishing, and any time the gateway's pricing changes.
//
//   node test/price-drift-test.mjs
//   GATEWAY_URL=http://127.0.0.1:4402 node test/price-drift-test.mjs

import { PRICES } from '../src/index.mjs';

const GATEWAY = (process.env.GATEWAY_URL || 'https://x402.donnyautomation.com').replace(/\/$/, '');

let failures = 0;
function check(name, pass, detail = '') {
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
  if (!pass) failures += 1;
}

let doc;
try {
  const r = await fetch(`${GATEWAY}/openapi.json`, { signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  doc = await r.json();
} catch (err) {
  // ★ Unreachable is a FAILURE, not a pass. A drift check that goes quiet when
  //   it cannot read the source is worse than no check: it reports green for a
  //   comparison it never made.
  console.log(`  FAIL  could not read ${GATEWAY}/openapi.json  — ${err.message}`);
  console.log('\nprice drift UNVERIFIED — this is not a pass');
  process.exit(1);
}

const declared = Object.entries(PRICES);
check('the price table is not empty', declared.length > 0, `${declared.length} routes`);

for (const [route, price] of declared) {
  const op = doc.paths?.[route]?.get;
  if (!op) { check(`${route} exists in the gateway catalogue`, false, 'route absent from /openapi.json'); continue; }
  const live = op['x-payment-info']?.price?.amount;
  if (live == null) { check(`${route} publishes a price`, false, 'no x-payment-info.price.amount'); continue; }
  // Compare NUMERICALLY: the gateway publishes "0.003000" and we declare
  // "0.003". A string compare would fail on formatting and train us to ignore it.
  const same = Number(live) === Number(price);
  check(`${route} advertised $${price} matches gateway $${Number(live)}`, same,
    same ? '' : `DRIFT — agents are being quoted ${price}, they will be charged ${Number(live)}`);
}

// The reverse direction: a paid route we could sell but do not expose is not an
// error, so it is reported rather than failed. Silence about it is how a
// product ships and never reaches the MCP surface.
const paidRoutes = Object.entries(doc.paths || {})
  .filter(([p, v]) => v.get?.['x-payment-info'] && !p.startsWith('/demo'))
  .map(([p]) => p);
const notExposed = paidRoutes.filter((p) => !(p in PRICES) && !/^\/(bsc|polygon|arbitrum|base|avalanche|ethereum)-/.test(p));
if (notExposed.length) {
  console.log(`\n  note: ${notExposed.length} paid route(s) exist but are not MCP tools:`);
  console.log(`     ${notExposed.join(' ')}`);
}

console.log(failures ? `\n${failures} price(s) have DRIFTED from the gateway` : '\nevery advertised price matches what the gateway charges');
process.exit(failures ? 1 : 0);
