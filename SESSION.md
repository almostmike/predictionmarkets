# Daily session runbook

What the agent does each run, in order (CLAUDE.md, "Daily session"). `CLAUDE.md` and `STRATEGY.md` govern; this file only says how. If any step fails, stop trading for the day, log the failure in the journal, and still publish.

Before starting: if the time is after 11:00 am PT on a scheduled run, exit without doing anything. Note `DRY_RUN` (from `.env`) in the journal.

1. **Reconcile.** `npm run reconcile`. Exit code 2 (no keys) or 3 (a position without a price) means no trading today.
2. **Review holdings.** `node scripts/holdings.ts`. For each flag (`q_flipped`, `edge_gone`, `forecast_status_*`, `settled_*`), apply the holding's exit condition from its decision record and STRATEGY.md.
3. **Scan.** `node scripts/match.ts`. Then:
   - Treat every flagged candidate as not tradable: `stale`, `started`, `beyondHorizon`, `excluded`, `incoherent`, `adverseMove`.
   - For each remaining candidate you'd consider a match, read both resolution texts:
     - Q's side: `q.resolution.criteria` in `.cache/match/<date>.json`.
     - Polymarket US: `node scripts/markets.ts <slug>`.
   - Apply the mandate's match test (same outcome, same deadline, rules that can't produce a different result).
   - For text-search candidates, decide orientation yourself.
   - Record each confirmed match:

     ```
     node scripts/match.ts record <q-market-key> <us-slug> --orientation same|flipped --rules "<comparison>"
     ```
4. **Decide.** Apply STRATEGY.md to the recorded matches and holdings. Write `.cache/proposals/<date>.json`:
   - with trades: `{ "proposals": [ … ] }`. Each proposal has the fields in `scripts/lib/guardrails.ts` (`Proposal`), a rationale of at most 100 words, and an exit condition.
   - with none: `{ "proposals": [], "no_trade_reason": "…" }`.
5. **Execute.** `node scripts/execute.ts .cache/proposals/<date>.json`. The executor applies the hard rules and logs every decision; don't argue with a rejection, and never call order endpoints any other way.
6. **Shadow.** `node scripts/shadow.ts`.
7. **Publish.**
   - Write `journal/YYYY-MM-DD.md`: what Q showed, what matched and why, decisions and rejections, holdings, Quotient credits used, and the CLI and contract versions.
   - Publish only what rule 15 allows from Q.
   - Then `npm test`, `npm run scan`, commit, and push. The pre-push hook re-runs the scan.

Costs: about $0.04 of Quotient credits for the scan, plus $0.01 per 10 holdings.
