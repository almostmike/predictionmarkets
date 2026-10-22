# Quotient notes

From Quotient's written answers of 2026-10-22, for CLI `quotient-forecasting` 0.8.36 and API contract 20.5.0. The live contract is authoritative: `https://dev.quotient.social/api/v1/openapi.json` and `GET /api/public/pricing` (free).

## Access
- The CLI is pinned in `package.json`. Run it as `npm run quotient -- <command> --json`, which loads `.env` and turns off the update check.
- A key is required: `quotient setup` stores it in `~/.config/quotient/config.json`, or set `QUOTIENT_API_KEY` in `.env`, which takes precedence. Without a key the CLI falls back to keyless x402 pay-per-call mode, so our wrapper must check that `quotient status --json` doesn't report `accessMode: x402` before any paid call.
- Keys don't expire and never need a browser login after `quotient setup`.
- Credits are prepaid ($10 buys 1,000 credits). An empty balance returns `403 insufficient_credits`; nothing charges automatically while auto-recharge is off. A 429 or an upstream error is not charged.
- `quotient status --json` shows access and the remaining balance (free).

## Cost per call
| Cost | Commands |
|---|---|
| Free | `--help`, `status`, `doctor`, `performance`, `forecast resolve`, `forecast status` |
| $0.005 | `assets list`, `markets list`, markets lookup, `sources`, `portfolio report`, featured signals |
| $0.01 | `assets search`, `markets search`, `market`, `forecast`, `signals`, `outlooks`, `stance` |
| $0.02 | `markets mispriced`, `updates` |
| $1.00 | `forecast request`, `research x`, `profile x` (barred by mandate rule 14) |

`forecast` and `market` take up to 10 references per call at one call's price. Expected daily cost is $0.10 to $0.30.

## Limits
20 requests/s, 600/min, 20,000 per UTC day, 10 in flight. On a 429, honor `Retry-After`.

## Coverage, and why matching is by event
- Q forecasts about 500 markets a day on international Polymarket (`polymarket`), Kalshi (`kalshi`), and HL Outcomes (`hl_outcomes`). Coverage is heaviest in politics and geopolitics, economics, commodities, and equity price questions.
- Sports game-winner forecasts exist but are labeled `q_coverage: experimental` (no established edge yet). Short-horizon crypto up/down markets are not forecast.
- **Polymarket US contracts have no Q forecasts**, and Quotient's stored Polymarket US prices are a stale August snapshot. So the agent:
  1. reads Q's forecast on another venue's contract for the same event;
  2. finds the Polymarket US contract for that event;
  3. compares the two resolution texts and logs the comparison;
  4. prices the trade from the live Polymarket US order book only.
- Published signals carry cross-venue `MATCHES_MARKET` references with `match_level` (`possible`, `same_event`, `same_outcome`) and `settlement_match` (`exact`, `different`, `unknown`).
- Useful calls: `markets mispriced --venue polymarket --min-spread 10pp --json` ($0.02), `markets list --tag <tag> --venue <venue> --json`, `signals --category <category> --json`, `forecast '<venue>:<nativeMarketId>' --json`.

## Fields
- Log these: `forecast.id` (UUID), `forecast.created_at`, `forecast.probability`, `forecast.market_odds_at_forecast`, `market.marketKey` (`venue:nativeMarketId`), `market.venue`, and `market.nativeMarketId`. For sports, also `sports.yes_side` and `sports.kickoff_at`.
- The probability is always for YES on the exact contract behind the `marketKey`. In sports, `sports.yes_side` names the team YES pays on; titles and outcome order don't.
- Confidence fields: `conviction_tier` (1 to 3), `conviction`, `quality` (often `insufficient`), and `drawdown_risk_72h` (`yes`/`no` flags). `band25`, `band75`, and `draw_std_log_odds` are null on current forecasts.
- `forecast_status` reads market movement against Q, not a change in Q's view:
  - `warning`: an adverse move of 25% or more;
  - `caution`: 15% or more;
  - `converged`, `converging`, `sideways`, `diverging`.
- Refresh timing: event markets are re-forecast daily, finishing by mid-morning Eastern, plus re-forecasts triggered by price moves. Sports refresh hourly until kickoff. 9:00 am PT is a fine run time.
- Outcomes are not a first-class field; take settlement from the venue (for us, the Polymarket US settlement endpoint).

## History (backtest)
`forecast <ref> --as-of <date> --history <0-10> --json`, $0.01 per call, one reference per call with `--as-of`. History goes back to 2026-02-13. `market_odds_at_forecast` allows replaying an edge rule from forecast reads alone.

## Track record (Quotient's numbers, 2026-10-22)
- Q beat the market on 59.9% of 3,369 resolved international Polymarket markets over 60 days. By cohort: geopolitics and global elections 62.1%, everything else 59.6%.
- Brier scores (lower is better), Q vs market:

  | Cohort | Q | Market |
  |---|---|---|
  | All markets, 60 days | 0.182 | 0.184 |
  | Geopolitics/elections, 60 days | 0.155 | 0.160 |
  | All time | 0.175 | 0.174 |

- Quotient calls this a small edge, concentrated in geopolitics and elections. There is no public breakdown by sport or venue.

## Publishing (mandate rule 15)
Allowed, attributed to Q with a link to quotient.social:
- probabilities, dated with `created_at`;
- forecast IDs and timestamps;
- forecast-time market prices;
- short excerpts of `headline`, `bluf`, and `crux`.

Not allowed: full theses, evidence lists, or bulk data.
