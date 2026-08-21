# agent-utils-mcp

**Eight utilities your agent can call — geocoding, weather, web search,
URL-to-Markdown, randomness and compliance lookups — paid per call in USDC on
Base via [x402](https://x402.org), from your own wallet.**

## Try it in 30 seconds

**This package is not on npm yet.** Install it straight from GitHub — this is the
command that works today:

```bash
npx -y github:donnywin85/agent-utils-mcp
```

That starts the MCP server on stdio and it will list all eight tools with **no
wallet and no key**. You only need a funded key to actually *call* one.

Add it to Claude Code — one line, and the tools are live in your next session:

```bash
claude mcp add agent-utils --env EVM_PRIVATE_KEY=0xyour_disposable_base_key -- npx -y github:donnywin85/agent-utils-mcp
```

## What it costs

| tool | what it does | price |
|---|---|---|
| `geocode` | address or place name → coordinates, with ranked candidates | $0.003 |
| `reverse_geocode` | coordinates → street address | $0.003 |
| `weather` | current conditions + up to a 7-day forecast for any coordinates | $0.003 |
| `web_search` | free-text query → ranked organic results (no ads) | $0.003 |
| `url_to_markdown` | article or PDF URL → clean Markdown | $0.003 |
| `secure_random` | CSPRNG bytes, or uniform integers in a range | $0.003 |
| `sanctions_screen` | OFAC SDN / consolidated sanctions screening for a name | $0.01 — see note |
| `lei_lookup` | GLEIF Legal Entity Identifier for a company | $0.03 |

Prices live in one table in `src/index.mjs`; `npm run pricecheck` compares it
against the gateway's own `/openapi.json` and fails on any drift.

> **Known drift, stated rather than hidden:** as of 2026-08-21 `npm run pricecheck`
> reports `/sanctions` advertised at $0.03 while the gateway charges **$0.01**. You
> are charged the gateway's price, so this errs in your favour — but the table is
> wrong until that is reconciled, and the check is red on purpose.

## You supply the wallet. This package ships no keys.

The server signs each payment with a key it reads from **its own env**, which
you set in your MCP client's config. Nothing is bundled, and no key is ever
sent anywhere except as an EIP-3009 signature to the x402 facilitator.

- Fund a wallet with a few dollars of **USDC on Base**.
- It needs **zero ETH** — payments use `transferWithAuthorization` and the
  facilitator broadcasts and pays the gas.
- **Use a low-balance, disposable wallet.** The key sits in your client config
  in plaintext; any process that can read that file can spend from it.

## Client config

Claude Desktop (`claude_desktop_config.json`), Cursor, or any MCP host:

```json
{
  "mcpServers": {
    "agent-utils": {
      "command": "npx",
      "args": ["-y", "github:donnywin85/agent-utils-mcp"],
      "env": {
        "EVM_PRIVATE_KEY": "0xyour_disposable_base_wallet_key"
      }
    }
  }
}
```

Tools list fine without a key — you can inspect what is on offer before funding
anything. The first *paid* call is where a missing key is reported, in as many
words:

```
/geocode failed: EVM_PRIVATE_KEY is not set. Add it to this MCP server's env in
your client config.
```

Argument names are short: `geocode` takes `q`, not `query`.

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

## Where to go next

- **You want the same utilities for free, without a wallet** — [`dex-data-mcp`](https://github.com/donnywin85/dex-data-mcp)
  carries `geocode`, `reverse_geocode`, `get_weather`, `search`, `url_to_markdown`
  and `get_random` on a keyless free tier, alongside 16 more tools. If you do not
  need this server's compliance pair, start there: `claude mcp add dex-data -- npx -y dex-data-mcp`.
- **You want cross-DEX market data** — [`arb-dex-mcp`](https://github.com/donnywin85/arb-dex-mcp)
  (keyless) or [`bsc-dex-spread-mcp`](https://github.com/donnywin85/bsc-dex-spread-mcp) (paid, one tool).
- **You want the human-approval loop these services are operated by** —
  [`approval-queue-starter`](https://github.com/donnywin85/approval-queue-starter), one file, zero deps.
- **Something is broken, or you want volume pricing** — the gateway returns a
  contact address on every `402`, and a human reads it.

## Licence

MIT.
