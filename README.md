# agent-utils-mcp

Eight paid utilities for AI agents, exposed as MCP tools and billed per call in
USDC on Base mainnet via [x402](https://x402.org): **$0.003** for the utility
tools, **$0.03** for the two compliance tools (OFAC screening, GLEIF LEI).

Prices live in one table in `src/index.mjs`; `npm run pricecheck` compares it
against the gateway's own `/openapi.json` and fails on any drift.

| tool | what it does |
|---|---|
| `geocode` | address or place name → coordinates, with ranked candidates |
| `reverse_geocode` | coordinates → street address |
| `weather` | current conditions + up to a 7-day forecast for any coordinates |
| `web_search` | free-text query → ranked organic results (no ads) |
| `url_to_markdown` | article or PDF URL → clean Markdown |
| `secure_random` | CSPRNG bytes, or uniform integers in a range |

## You supply the wallet. This package ships no keys.

The server signs each payment with a key it reads from **its own env**, which
you set in your MCP client's config. Nothing is bundled, and no key is ever
sent anywhere except as an EIP-3009 signature to the x402 facilitator.

- Fund a wallet with a few dollars of **USDC on Base**.
- It needs **zero ETH** — payments use `transferWithAuthorization` and the
  facilitator broadcasts and pays the gas.
- **Use a low-balance, disposable wallet.** The key sits in your client config
  in plaintext; any process that can read that file can spend from it.

## Install

```json
{
  "mcpServers": {
    "agent-utils": {
      "command": "npx",
      "args": ["-y", "agent-utils-mcp"],
      "env": {
        "EVM_PRIVATE_KEY": "0xyour_disposable_base_wallet_key"
      }
    }
  }
}
```

Tools list fine without a key — you can inspect what is on offer before funding
anything. The first *paid* call is where a missing key is reported.

## What each call returns

Every tool returns the upstream JSON plus, on a successful payment, the
settlement transaction hash:

```
(paid $0.003 USDC — settle tx 0xb2397b96…)
```

That is deliberate: you can verify on Basescan that you were charged once, for
what you got, rather than taking the server's word for it.

## Design notes

The first six were not chosen by guesswork. They are the categories that USDC
receipts across 1,062 x402 seller wallets showed agents actually pay for —
geocoding (56 payers), weather (21), article/PDF→Markdown (7), randomness (6),
web search (6).

The upstreams follow two rules worth knowing as a caller:

- **A missing value is `null` with a reason, never a plausible-looking number.**
  Weather reports no reading rather than zero; reverse-geocode says "ocean or
  unmapped" rather than inventing an address.
- **The limits of an answer are stated in the answer.** Forecast rows are
  labelled model output; search says results are unverified and that its ranking
  is DuckDuckGo's; `web_search`'s `count` is a maximum, not a promise, because a
  result whose destination cannot be resolved is dropped rather than guessed at.

`url_to_markdown` refuses private, loopback, link-local and cloud-metadata
addresses, and re-validates every redirect hop — it fetches caller-supplied URLs
from inside a private network, so that guard is not optional.

## Licence

MIT.
