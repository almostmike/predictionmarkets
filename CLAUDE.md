# CLAUDE.md — Prediction Markets: An AI Trades Prediction Markets with an Oracle

Version 0.2 (2026-10-21). Approved by the operator on 2026-10-21 and binding from its first commit to the public repo `almostmike/predictionmarkets`.

## What this is

One AI agent (Claude, run headless on a daily schedule) manages a $100 Polymarket US account. It reads forecasts from Quotient ("Q") through Quotient's official CLI or MCP server, compares them to live market prices, and decides what, if anything, to trade. Every decision, including the decision not to trade, is committed to this public repo and shown at https://almostmike.github.io/predictionmarkets/.

**The question:** Given a forecasting oracle, can an AI trader make money? And does its judgment beat simply following the oracle?

## Roles

- **Operator (Mike):** owns the accounts and the keys, sets this mandate, approves amendments to it. Does not pick trades.
- **Agent (Claude):** researches, decides, writes rationales, maintains the ledger and site.
- **Quotient (Q):** read-only forecast source through its CLI (`quotient-forecasting`) or MCP server. It does not trade and has no access to the account.
- **Executor (`scripts/execute.ts`):** the only code that places orders on Polymarket US. It enforces the hard rules below no matter what the agent requests.

## Disclosure (published on the site)

- A friend of the operator works at Quotient. Quotient provided access to <describe access; pending Quotient's answer>. Quotient has no say in decisions and no access to the account.
- <Any fees or compensation Quotient receives from this experiment; pending Quotient's answer.>

## Mandate

The operator sets the mandate. The agent may not change it.

1. **Objective:** grow the account. NAV against the $100 start is the headline number.
2. **Capital:** $100. No deposits after the start and no withdrawals while the experiment runs.
3. **Venue:** Polymarket US only, through its official API, from the operator's Mac in the US. Never use international Polymarket, a VPN, or non-US infrastructure.
4. **Position cap:** a single market may not exceed **5% of current NAV** at the time of entry (about $5 at the start). Adding to a position counts toward the cap. If the venue's minimum order is larger than the cap allows, skip the market.
5. **Open positions:** at most 15 at a time.
6. **Minimum edge:** enter only when the edge is at least **10 percentage points after fees**. For a YES buy, edge = Q probability − (limit price + fee per contract); for a NO buy, edge = (1 − Q probability) − (NO limit price + fee per contract). The executor always assumes the taker fee (currently 0.0695 × p × (1 − p) per contract), even for orders that may rest as makers.
7. **Orders:** limit orders only. A buy's limit price may be at most $0.02 above the best ask. No market orders.
8. **Daily entry limit:** at most $25 of new entries per calendar day (Pacific time).
9. **Drawdown halt:** if NAV falls below $20, stop all new entries, publish a note, and wait for the operator. Exits are still allowed.
10. **Excluded markets:**
    - anything involving Intuitive Surgical or its competitors (ISRG, JNJ, ZBH, SNN, SYK, MDT);
    - markets about Quotient itself;
    - anything involving SDSU or SJSU, including their athletic teams and any game either team plays in;
    - other events the operator, his family, or his institutions could influence or hold nonpublic information about.

    Sports markets are otherwise allowed.
11. **No leverage, no transfers, no shorting** other than buying NO shares.
12. **Horizon:** enter only markets scheduled to resolve within **60 days** of the entry date (Pacific time). If the resolution date is unknown or open-ended, do not enter.
13. **Duration:** the experiment has no set end date. The operator may end it with a dated amendment. On that date, open positions are marked at the best bid for the final scoreboard and labeled "unresolved"; they may be held to resolution afterward and reported separately.
14. **Quotient spend:** use only free or operator-provided Quotient access. No paid forecast requests (for example, `quotient forecast request`) unless the operator sets a budget by amendment. Quotient costs are never paid from the trading account.

Rules 4–12 also live in `config/rules.json` and are enforced in `scripts/execute.ts`. When a request breaks a rule, the executor rejects it and the rejection is logged publicly. Changing `rules.json` requires an operator-approved, dated amendment to this file.

## Agent strategy

The agent writes its own strategy; the operator does not. Before the first trade, the agent writes `STRATEGY.md` v1.0 in its own words, within this mandate. It may set stricter thresholds than the mandate but never looser ones. It covers:

- which Q forecasts it will consider (categories, time to resolution, liquidity);
- when it follows Q, when it overrides Q, and what evidence justifies an override;
- how it sizes positions inside the 5% cap (for example, fractional Kelly) and how it handles correlated markets;
- when it exits: hold to resolution, take profit, Q flips, new information;
- what it will not do.

`STRATEGY.md` is committed and published before any order. Any change requires a dated amendment with a one-paragraph explanation in that day's journal, published before the change governs a trade. Never edit it retroactively.

## Daily session

The run is scheduled for 9:00 am PT on the operator's Mac. If the Mac is off or asleep, the day is skipped. If a run starts after 11:00 am PT (for example, launchd catching up after the Mac wakes), it exits without doing anything. A missed day is just a gap in the record.

Each run does the following, in order:

1. **Reconcile.** Pull balance, positions, open orders, and fills from Polymarket US. The broker is the source of truth. Update `data/positions.json` and `data/nav.json`.
2. **Review holdings.** Get the latest Q forecast for each held market. Flag flips, resolutions, and exit conditions.
3. **Scan.** Pull current Q forecasts and match each one to a Polymarket US market.
   - A match requires the same question, the same deadline, and the same resolution source. If Q links the forecast directly to the Polymarket US market, that link counts; otherwise, if any of the three is uncertain, record no match.
   - Not every forecast will have a market; that's expected.
   - Append every matched forecast and its market price to `data/forecasts.jsonl`, whether or not it is traded.
4. **Decide.** Apply `STRATEGY.md` and produce zero or more proposed orders, each with a full decision record. "No trade today" is a valid decision and gets logged.
5. **Execute.** Send proposals to the executor. Record fills, rejections, and cancellations.
6. **Shadow portfolio.** Update `data/shadow.json` (see Benchmarks).
7. **Publish.** Write `journal/YYYY-MM-DD.md`, commit, and push. The site reads the JSON directly. The commit and the site are the only notification; nothing else is sent to the operator.

If any step fails, do not trade. That includes Polymarket US or Quotient being unavailable and account state that doesn't reconcile. Log the failure and push.

## Decision record

Every proposed, rejected, or executed trade appends one record to `data/decisions.jsonl`:

| field | notes |
|---|---|
| `id`, `timestamp` | |
| `market_id`, `question`, `resolves_at` | Polymarket US identifiers |
| `side` | YES or NO |
| `q_forecast_id`, `q_prob`, `q_timestamp` | exactly what Q said, and when |
| `bid`, `ask` | at decision time |
| `agent_prob` | the agent's own estimate; may equal `q_prob` |
| `edge_after_fees` | in percentage points |
| `size_usd`, `pct_nav` | |
| `rationale` | at most 100 words, plain English, ready to publish |
| `exit_condition` | what would make the agent sell before resolution |
| `status` | proposed / rejected (with rule) / filled / partial / cancelled / dry_run |

## Benchmarks

- **Primary:** NAV against $100.
- **Oracle shadow:** a paper portfolio that follows Q mechanically, starting with $100. It buys Q's favored side at the ask, $5 per entry, in every matched market that meets rule 6, in the order the forecasts were logged. It follows the same position, daily, horizon, and exclusion rules as the real account, pays the same taker fees, holds to resolution, and skips entries when its cash is under $5. This answers whether the agent's judgment beat blindly following the oracle.
- **Calibration**, across every resolved forecast in `forecasts.jsonl`:
  - Brier score of Q, and Brier score of the market price at log time;
  - Brier score of the agent's own probability wherever it differs from Q.

## Repo layout

The working clone lives at `~/Code/predictionmarkets` on the operator's Mac. GitHub is canonical; this OneDrive folder keeps drafts and notes.

```
/
├─ CLAUDE.md                this mandate
├─ STRATEGY.md              agent-authored, versioned
├─ config/rules.json        machine-readable hard rules
├─ scripts/
│  ├─ daily.sh              launchd entry point; time-window check, then `claude -p`
│  ├─ reconcile.ts          read-only account sync
│  ├─ execute.ts            the only file that places orders
│  ├─ match.ts              Q forecast to Polymarket US market matching
│  └─ shadow.ts             oracle shadow portfolio
├─ data/
│  ├─ nav.json              daily NAV series
│  ├─ positions.json
│  ├─ trades.json           fills
│  ├─ decisions.jsonl       every decision record, including rejections
│  ├─ forecasts.jsonl       every matched Q forecast against price
│  └─ shadow.json
├─ journal/YYYY-MM-DD.md    daily notes, including no-trade days
├─ docs/
│  ├─ index.html            GitHub Pages site
│  └─ QUOTIENT.md           Quotient commands/tools, fields, and costs
├─ ops/                     launchd plist
├─ .mcp.json                Quotient MCP config, if used (no secrets)
└─ .env                     gitignored; Polymarket US API keys
```

## Public site

Match the structure of agentstocks' "The Ledger." It is a static page that reads `data/*.json` directly: no build step, works at phone width.

- **Header:** one-paragraph description, a link to the launch article (until it exists, link to the operator's blog at https://todasco.com), a single rules line, and the disclosure.
- **Cards:** NAV, return %, oracle shadow return, open positions, cash.
- **Chart:** NAV against the oracle shadow, with a flat $100 reference line.
- **Open positions:** market, side, shares, average cost, current price, Q probability, value, resolution date.
- **Trade ledger:** reverse chronological, each trade with its rationale.
- **Decisions:** no-trade days and rejected orders, with the rule that blocked each one.
- **Scorecard:** resolved wins and losses, Brier scores for Q, the market, and the agent.

## Security

- **The repo is public.** Never commit keys, account IDs, email addresses, or raw API responses.
- **Keys:** Polymarket US keys live in `.env`, which the operator fills in. The Quotient key stays in the Quotient CLI's own config outside the repo. The agent never prints or echoes either.
- **Secret scan:** run one (gitleaks) before every push; a failed scan blocks the push.
- **Order path:** only the executor can place orders. The agent calls the executor and never the Polymarket US order endpoints directly.
- **Kill switch:** if a file named `STOP` exists in the repo root, the executor rejects every order.

## Build phases

0. **Operator:** open and verify a Polymarket US account (do not fund yet), then run `quotient setup` to sign in to Quotient.
1. Scaffold the repo, `rules.json`, `.gitignore`, and secret scanning.
2. Build a read-only Polymarket US client covering markets, order books, balance, and positions. Verify it against the official docs at docs.polymarket.us and pin dependency versions.
3. Connect Quotient. Document its commands or tools, fields, and per-call costs in `docs/QUOTIENT.md`, and build forecast-to-market matching with a confidence field.
4. Build the executor with guardrails. Every rule gets a unit test: cap, max positions, edge, daily limit, drawdown, exclusions, horizon, STOP.
5. Dry run: run the full daily session for at least 2 days with orders logged as `dry_run`, and publish the results.
6. Build the site.
7. The agent writes `STRATEGY.md` v1.0. The operator reviews it for mandate compliance only, then it is committed.
8. Go live: the operator funds $100 and sets `DRY_RUN=false`.
9. Schedule the daily run at 9 am PT with launchd on the operator's Mac, calling `scripts/daily.sh`. It uses the `claude` command-line tool, so the Claude app does not need to be open, but the Mac must be awake and logged in.

## Open items

- Polymarket US: minimum order size and API rate limits (check in phase 2).
- Quotient: access terms, costs, and the remaining questions sent to the Quotient contact on 2026-10-21.
- Disclosure wording, confirmed with the Quotient contact.

## Amendments

- **v0.2, 2026-10-21 (agent draft, approved by the operator 2026-10-21):** named the experiment and repo; removed the end date and rewrote rule 12 as a 60-day horizon at entry; added rule 13 (no end date) and rule 14 (Quotient spend); excluded SDSU and SJSU, including athletics, and confirmed sports are allowed; defined the fee math in rule 6 and the price limit in rule 7; allowed Quotient's CLI as well as MCP; defined the oracle shadow; added the skip-the-day rule and dropped the separate notification; linked the operator's blog until the launch article exists; added phase 0 for the operator.
