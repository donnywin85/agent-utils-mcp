// x402 buyer client — signs a USDC payment per request and returns the payload
// plus proof of settlement.
//
// The wallet is the INSTALLING USER'S. This package ships no keys and never
// reads a key from anywhere but its own env.

import { wrapFetchWithPayment } from '@x402/fetch';
import { x402Client } from '@x402/core/client';
// NOTE: /client, not /server — the server export registers the seller side and
// silently fails to match the buyer's scheme.
import { registerExactEvmScheme } from '@x402/evm/exact/client';
import { privateKeyToAccount } from 'viem/accounts';

const DEFAULT_GATEWAY = 'https://x402.donnyautomation.com';

// The settle txHash rides in the PAYMENT-RESPONSE header as base64 JSON. Its
// shape is not contractual, so search rather than index a fixed path — and
// return null instead of guessing if it is absent.
function extractTxHash(res) {
  const raw = res.headers.get('payment-response') || res.headers.get('PAYMENT-RESPONSE');
  if (!raw) return null;
  try {
    const decoded = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
    let found = null;
    const walk = (node) => {
      if (found || !node || typeof node !== 'object') return;
      for (const [k, v] of Object.entries(node)) {
        if (found) return;
        if (/^(transaction|txhash|tx_hash)$/i.test(k) && typeof v === 'string' && v.startsWith('0x')) {
          found = v;
          return;
        }
        if (v && typeof v === 'object') walk(v);
      }
    };
    walk(decoded);
    return found;
  } catch {
    return null;
  }
}

export function createPaidClient() {
  const key = process.env.EVM_PRIVATE_KEY;
  if (!key) {
    throw new Error(
      'EVM_PRIVATE_KEY is not set. Add it to this MCP server\'s env in your client config. ' +
      'Use a low-balance disposable wallet funded with a few dollars of USDC on Base — ' +
      'it needs ZERO ETH, and the key sits in that config in plaintext.',
    );
  }

  const account = privateKeyToAccount(key.startsWith('0x') ? key : `0x${key}`);
  const client = new x402Client();
  registerExactEvmScheme(client, { signer: account });
  // arg2 is the CLIENT, not a bare signer — passing the signer here fails at
  // payment time, not at construction, so it looks like a gateway fault.
  const fetchWithPay = wrapFetchWithPayment(fetch, client);
  const gateway = (process.env.GATEWAY_URL || DEFAULT_GATEWAY).replace(/\/$/, '');

  return {
    address: account.address,
    async call(routePath, params = {}) {
      const qs = new URLSearchParams(
        Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''),
      ).toString();
      const url = `${gateway}${routePath}${qs ? `?${qs}` : ''}`;
      const res = await fetchWithPay(url, { headers: { accept: 'application/json' } });
      const text = await res.text();
      let body;
      try { body = JSON.parse(text); } catch { body = text; }
      return { status: res.status, body, txHash: extractTxHash(res) };
    },
  };
}
