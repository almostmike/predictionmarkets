# Backtest (phase 3a), 2026-10-23

**Headline: on this sample, following Q's 10-point disagreements lost money, after fees and a modest spread, in the categories STRATEGY.md v1.0 treats as eligible.** STRATEGY.md section 7 commits the agent to proposing a stricter v1.1 before going live in that case.

Results are aggregates only. Quotient's terms don't allow republishing its forecasts in bulk, so the per-market data stays on the operator's Mac. The machine-readable summary is `data/backtest.json`.

## What was tested

- **Markets:** resolved binary markets on international Polymarket with end dates from 2026-02-20 to 2026-10-21. They were listed from Polymarket's public data (read only; nothing traded) by topic tag:
  - eligible: politics, elections, geopolitics, economy, Fed rates, inflation, finance, commodities, stocks;
  - comparison: NFL, NBA, NHL, and college football games.

  Each was checked for Q coverage, highest volume first for the eligible tags and most recent first for games. 1,148 markets were checked.
- **Q's forecasts:** for the 462 markets Q covered, Q's last forecast before resolution plus up to 10 earlier ones (`quotient forecast --as-of <resolution> --history 10`). A forecast was usable if it came 12 hours to 60 days before resolution, the mandate's and strategy's horizon.
- **Usable sample:** 192 markets (178 eligible, 14 sports) with 1,137 forecasts.
- **Rule replay:** one position per market, at the first forecast that qualified, held to resolution.
  - **Entry price:** the market price stored with Q's forecast (a midpoint), plus 1 cent for half the spread, plus the Polymarket US taker fee (0.0695 × p × (1 − p)).
  - **Mandate rule:** Q's probability for the chosen side beats the all-in cost by 10+ points.
  - **Strategy v1.0:** the mandate rule plus the agent's blend, market + k × (Q − market) with k = 0.5, beating the cost by 4+ points. Values of k from 0.25 to 1.0 were also tested.
- **Cost:** 2,780 Quotient credits (about $2.78) of the $5 budget.

## Results

**Accuracy (Brier score, lower is better), on every usable forecast:**

| | Forecasts | Q | Market price when Q forecast |
|---|---|---|---|
| Eligible categories | 1,071 | 0.197 | 0.171 |
| Sports games | 66 | 0.358 | 0.326 |

**Returns from following the rules** (mean return per $1 staked, with a 90% bootstrap interval):

| Rule | Slice | Trades | Win rate | Mean | 90% interval |
|---|---|---|---|---|---|
| Mandate only | Eligible | 109 | 52% | −15.7% | −29.9% to −2.2% |
| Strategy v1.0 | Eligible | 105 | 51% | −16.7% | −31.0% to −2.2% |
| Strategy v1.0 | Eligible, YES side | 28 | 21% | −46.1% | −78.5% to −8.6% |
| Strategy v1.0 | Eligible, NO side | 77 | 62% | −6.1% | −20.9% to +8.6% |
| Strategy v1.0 | Politics | 74 | 45% | −22.1% | −40.7% to −3.6% |
| Strategy v1.0 | Geopolitics | 29 | 72% | +2.8% | −19.0% to +23.4% |
| k = 0.25 | Eligible | 53 | 38% | −10.5% | −38.6% to +17.9% |
| Mandate only | Sports | 4 | 25% | — | too few to read |

At k = 0.75 and above, the agent's 4-point test never binds beyond the mandate's 10-point rule, so those results equal "mandate only."

## How this compares with Quotient's own report

Quotient's free performance report (`quotient performance`, generated 2026-10-24) shows positive hypothetical returns for the same idea. Buying the side Q considers underpriced when the gap is 10+ points and holding to resolution averages +13.8% across all markets all-time, and +2.9% for geopolitics and elections all-time. The differences that likely explain the gap:

- **Costs:** Quotient's figures exclude fees and spread; ours include both. At an average entry cost of about $0.55, fees and the half spread take roughly 3–4 cents.
- **Sample:** ours is the highest-volume political and geopolitical markets, which are probably the most efficient, plus only the last 11 forecasts before each resolution. Quotient's report covers all 4,760 resolved markets and weights each market once.
- **Accuracy:** Quotient's own all-time numbers for geopolitics and elections also show Q's Brier slightly worse than the market's (0.140 vs 0.131). Its 60-day numbers show Q slightly better (0.156 vs 0.161).

## Limits

- **Small sample:** 105–109 trades, with wide intervals. The geopolitics result is positive but not distinguishable from zero.
- **Entry prices are approximate:** midpoints stored with Q's forecasts, not executable asks. Real fills could be better (resting orders pay no fee) or worse (thin books).
- **Venue:** the prices are international Polymarket's, not Polymarket US's. US prices for the same events track them closely but aren't identical.
- **Selection:** markets were chosen by volume and Q coverage, and the history call returns only the last 11 forecasts before resolution. Earlier forecasts on long-running markets weren't seen.
- **Sports:** too few resolved, Q-covered games (14) to say anything.

## What it means for the strategy

On this evidence, Q's big disagreements with liquid political markets were more often Q's error than the market's, especially when Q favored YES. Strategy v1.0's blend (k = 0.5) didn't change which trades qualified enough to help, because its 4-point test rarely binds once the mandate's 10-point test passes. Per STRATEGY.md section 7, the agent will propose a stricter v1.1 before trading live.

## Reproducing

Scripts are in `scripts/backtest/`. Run them in order, all pointing at the same working folder under `.cache/`:
1. `candidates.py`
2. `check.py`
3. `history.py`
4. `replay.py`

The raw Quotient responses they cache are never committed.
