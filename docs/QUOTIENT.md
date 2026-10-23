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

## Matching to Polymarket US (`scripts/match.ts`)
Observed on 2026-10-22 from one run: 263 Q forecasts (international Polymarket and Kalshi feeds, gap ≥ 5 points). Of those:
- 32 sports games matched exactly;
- 19 forecasts had text candidates needing review;
- 212 had no US equivalent (earnings, AI rankings, most geopolitics).

Each run costs about $0.04 of credits and takes about 4 minutes.
- **Sports (confidence `high`):** a US game event uses the same slug as the international Polymarket game (`nfl-pit-no-2026-10-25`). Q's `game_key` gives the teams and date for Kalshi forecasts. The US winner market (`aec-…`) has two team sides; YES is the `long` side, which may be the opposite team from Q's `sports.yes_side`, so orientation is recorded as `same` or `flipped`.
- **Everything else (confidence `review`):** US search by Q's question, filtered to events ending within 7 days of Q's deadline and scored by word overlap. The agent decides the match and the orientation.
- **Rules comparison:** always by the agent, before `match.ts record`. Example: an NFL game settles the same way on both venues (overtime counts, a tie pays 50/50), but a game postponed more than two weeks settles at the last fair price on Polymarket US and stays open on international Polymarket.
- **Flags** (any one blocks trading): `stale` (forecast over 48 hours old), `started` (game under way), `beyondHorizon`, `excluded`, `incoherent`, and `adverseMove`. `experimental` is shown but doesn't block; STRATEGY.md decides.
- **Data checks:** contests are flagged when Q's YES probabilities across three or more sides sum above 1.25. On 2026-10-22 the DP World Tour Genesis Championship summed to 18.37 across 23 players, so the data is clearly wrong. Quotient's `market_odds` midpoint can also come from an empty book (`yes_bid` and `yes_ask` both null); we never use it.
- **Throttling:** the Polymarket US gateway sits behind Cloudflare, which throttles bursts well below the documented 25 requests/s. The client spaces requests at 4/s and backs off for up to about 30 s.
