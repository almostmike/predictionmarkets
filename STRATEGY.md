# STRATEGY.md — v1.0

2026-10-23. Written by the agent (Claude) under CLAUDE.md v0.4. The operator reviewed it for mandate compliance on 2026-10-23; it is binding from this commit. Changes need a dated amendment, explained in that day's journal and published before they govern a trade. This file never loosens a mandate rule; where both apply, the stricter one wins.

## The view behind it

Q is a good forecaster, but not a much better one than the market. On Quotient's own numbers, Q's Brier score over 60 days is 0.182 against the market's 0.184 across all resolved markets, and 0.155 against 0.160 in geopolitics and elections. That is a small edge, concentrated in one area. Q's sports forecasts have no track record yet; Quotient labels them experimental. On our first two dry-run days, Q's sports forecasts sat a median 9.4 points away from liquid Polymarket US prices.

When a slightly-better forecaster disagrees with the market by 10 points, the likeliest truth is somewhere in between. So the agent treats Q as strong evidence, not as the answer: it blends Q with the market price, and it trades only where Q is both far from the market and in an area where Q has shown it is better. The oracle shadow follows Q without that judgment, so the experiment measures whether the judgment helps.

## 1. Which forecasts it considers

A forecast is eligible only if all of these hold:

- It is matched to a Polymarket US contract under the mandate's test and recorded in `data/forecasts.jsonl` with its rules comparison.
- None of the matcher's flags is set: stale, started, beyond horizon, excluded, incoherent, or adverse move.
- Its category has **forecasting** coverage from Quotient, not `experimental`. Today that admits elections and politics, geopolitics, economics releases (Fed, CPI, jobs, GDP), and commodity and equity questions. It excludes Q's sports game forecasts.
- The Polymarket US book is tradable: the spread is $0.05 or less, and the side the agent would buy shows at least the planned size within $0.02 of the best price.
- It resolves at least 12 hours after the order and within the mandate's 60 days.

**Unlocking sports.** Experimental sports become eligible only by amendment, and only when both of these hold:
- Quotient grades the sports cohort as something other than `insufficient`.
- Our own scorecard shows at least 30 resolved, matched sports forecasts on which Q's Brier score beats the Polymarket US price at the time it was logged.

Until then the agent logs sports matches every day (they feed the shadow and the scorecard) and doesn't trade them.

## 2. Following and overriding Q

**The agent's probability** for the contract's YES is a blend:

> agent = market + k × (Q − market)

- `market` is the Polymarket US midpoint when the agent decides.
- `k` is how much of Q's disagreement the agent believes. It is **0.5** for every eligible category in v1.0. That's half credit, reflecting Q's small measured edge. The scorecard and the backtest (phase 3a) are the evidence for changing `k` by amendment, by category.

**Entry needs both:**
- the mandate's test: Q's probability beats the price by 10+ points after fees;
- the agent's own test: the agent's probability beats the price by **4+ points** after fees.

In practice this means Q must disagree with the market by roughly 11–12 points or more.

**Overrides only ever reduce risk.** The agent may skip a trade Q favors, or exit early, but it never bets against Q's direction and never sizes up beyond what the blend supports. Each of these reasons to skip is written in the decision record:
- **Stale against the news:** material news (injury, poll, data release, official statement) landed after Q's forecast was created and isn't reflected in it.
- **Rules risk:** the contingency-only difference between venues is live, for example a game or event already postponed or under weather or legal threat.
- **Thin evidence:** Q's own quality field for the market says `insufficient`, and the gap rests on a single forecast that moved sharply from its prior.

## 3. Sizing and correlation

- **Size:** quarter-Kelly on the agent's probability. For a side bought at all-in cost `c` (price plus fee) with agent probability `p`, the stake is 0.25 × (p − c) / (1 − c) × NAV. It is capped at the mandate's 5% of NAV, rounded down to the market's contract step, and skipped if below one minimum order.
- **One position per event.** Never both sides, and never two contracts on the same outcome.
- **Correlated groups** share a cap of **10% of NAV** in total. A group is one election night's races driven by the same national swing, one data release (all CPI brackets, for example), one central-bank decision, or one team's games in a week.
- **Daily budget:** the mandate's $25 is a ceiling, not a target. With more eligible trades than budget, the agent takes them in order of agent edge.

## 4. Orders

- **Price:** limit orders, placed at the best price on the agent's side when the spread is $0.01 or less. When it is wider, the order is placed one tick inside the spread and rests as a maker, which pays no fee.
- **Edge check:** the mandate's edge test always assumes the taker fee, so a resting order must clear the bar as if it took liquidity.
- **Expiry:** orders expire at the end of the Pacific day (the executor's default). A partly filled order is not chased the next day unless the trade still qualifies fresh.

## 5. Exits

The default is to hold to resolution. Selling early costs the spread and a fee, and the experiment scores resolved outcomes. The agent exits before resolution only for one of these:

- **Q flips:** Q's latest forecast puts the held side below 50%.
- **Edge gone:** the bid for the held side is at or above the agent's current probability for it, minus the taker fee. The market has reached the agent's fair value, so the remaining upside isn't worth the risk.
- **Rules event:** the contingency-only difference is live (for example, a game is postponed) and the two venues may now settle differently. The agent reassesses, and exits if it can't confirm the outcome rule.
- **Mandate halt:** the drawdown halt doesn't force exits, but if NAV falls below $20 the agent reviews every position against these rules the same day.

A `forecast_status` of `caution` or `warning` (the market moving against Q) is not by itself a reason to exit. Quotient says it describes price movement, not a change in Q's view.

## 6. What the agent will not do

- Trade any category marked experimental, until it is unlocked by amendment (section 1).
- Bet against Q's direction, or use Q's stored Polymarket US prices for anything.
- Trade during a game or event, or within 12 hours of resolution.
- Add to a position after entry, except to complete the planned size on the same day.
- Buy paid forecast requests, act on a single contest whose probabilities don't add up, or trade a contract whose rules it couldn't read on both venues.
- Change this strategy mid-session. Amendments take effect the day after they are published.

## 7. Review

- **Weekly**, in the Sunday journal: the scorecard (Brier for Q, the market, and the agent), the agent against the shadow, and whether `k`, the 4-point bar, or the sports gate should change. Any change goes through an amendment.
- **Before go-live:** the phase 3a backtest has not been run yet. If it shows that Q's 10-point disagreements in eligible categories lost money against the market price, the agent will propose a stricter v1.1 before trading.

## Amendments

- **v1.0, 2026-10-23:** first version. Reviewed by the operator for mandate compliance on 2026-10-23.
