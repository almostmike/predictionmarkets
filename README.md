# Prediction Markets

An AI agent (Claude) manages a $100 Polymarket US account using forecasts from Quotient (Q), and logs every decision here, including the days it doesn't trade. The mandate is [CLAUDE.md](CLAUDE.md); the public ledger is at https://almostmike.github.io/predictionmarkets/.

**Status:** dry runs (phase 5). The public ledger is at https://almostmike.github.io/predictionmarkets/ (`docs/index.html`, which reads `data/` directly). The account is funded, but `DRY_RUN` is on, so no orders are placed. The agent's strategy is in [STRATEGY.md](STRATEGY.md), and the pre-launch backtest is in [docs/BACKTEST.md](docs/BACKTEST.md); the daily procedure is in [SESSION.md](SESSION.md), and it runs at 9 am PT on the operator's Mac (see [ops/README.md](ops/README.md)); each day's notes are in [journal/](journal/).

## Setup (operator's Mac)

```sh
npm ci
cp .env.example .env               # then fill in Polymarket US keys; never commit .env
git config core.hooksPath .githooks  # pre-push secret scan
```

Requires Node 22.18+ (TypeScript runs directly; there is no build step) and `gitleaks` on `PATH`.

## Commands

| Command | What it does |
|---|---|
| `npm test` | Unit tests; `LIVE=1 npm test` also hits public Polymarket US endpoints |
| `npm run markets` | Coverage summary of active Polymarket US markets (public, no keys) |
| `node scripts/markets.ts <slug>` | One market: details, best bid/ask, top of book |
| `node scripts/match.ts` | Pull Q forecasts (about $0.04), propose Polymarket US matches, price them; writes `.cache/match/YYYY-MM-DD.json` |
| `node scripts/match.ts record …` | Append an agent-confirmed match, with its rules comparison, to `data/forecasts.jsonl` |
| `npm run quotient -- <cmd>` | The pinned Quotient CLI (add `--json`) |
| `node scripts/execute.ts <proposals.json>` | The executor: checks each proposal against the hard rules, previews it with the exchange, and places it only when `DRY_RUN=false`. Logs every decision to `data/decisions.jsonl` |
| `node scripts/holdings.ts` | Review held markets against Q's latest forecast |
| `node scripts/shadow.ts` | Update the oracle shadow portfolio in `data/shadow.json` |
| `node scripts/score.ts` | Check settlements and update Brier scores in `data/scorecard.json` |
| `npm run reconcile` | Read-only account sync into `data/positions.json` and `data/nav.json` (needs keys) |
| `npm run scan` | Secret scan of history and working tree (also runs before every push) |

## Layout

Set `PM_DATA_DIR` to a scratch folder to rehearse without touching the public `data/` files. Create a file named `STOP` in the repo root to reject every order.

See CLAUDE.md, "Repo layout." `config/rules.json` holds the machine-readable hard rules. `scripts/lib/polymarket.ts` is read-only by design and a test enforces that; only `scripts/execute.ts` (phase 4) will place orders.
