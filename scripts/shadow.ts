// Daily session step 6: the oracle shadow, a paper portfolio that follows Q mechanically (CLAUDE.md, Benchmarks).
//   node scripts/shadow.ts
// From today's matched forecasts in data/forecasts.jsonl it buys Q's favored side at the ask, $5 per entry,
// wherever rule 6's edge holds, under the same position, daily, horizon, and exclusion rules, paying taker
// fees, holding to resolution. Marks open positions at the price they could be sold at and settles
// resolved ones from Polymarket US. Writes data/shadow.json.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { DATA_DIR } from './lib/env.ts';
import { createReadOnlyClient } from './lib/polymarket.ts';
import { exclusionHits, loadRules, takerFeePerContract } from './lib/rules.ts';
import { daysUntil, ptDate } from './lib/time.ts';

const STAKE = 5;
const rules = loadRules();
const pm = createReadOnlyClient({});
const today = ptDate();
const path = `${DATA_DIR}/shadow.json`;
const s = JSON.parse(readFileSync(path, 'utf8'));
s.positions ??= [];
s.closed ??= [];
s.series ??= [];
const r2 = (x: number) => Math.round(x * 100) / 100;
const r4 = (x: number) => Math.round(x * 10000) / 10000;

// 1. Settle anything that has resolved.
for (const p of [...s.positions]) {
  const st = await pm.settlement(p.market).catch(() => null);
  if (!st) continue;
  const payout = p.contracts * (p.side === 'YES' ? st.price : 1 - st.price);
  s.cash = r2(s.cash + payout);
  s.positions = s.positions.filter((x: any) => x !== p);
  s.closed.push({ ...p, settled_at: st.settledAt, settlement: st.price, payout: r2(payout), pnl: r2(payout - p.cost) });
}

// 2. Enter today's qualifying matches, in the order they were logged.
const logged = existsSync(`${DATA_DIR}/forecasts.jsonl`)
  ? readFileSync(`${DATA_DIR}/forecasts.jsonl`, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
  : [];
let spentToday = s.positions.filter((p: any) => p.entered === today).reduce((a: number, p: any) => a + p.cost, 0);
const entries = [];
for (const f of logged.filter((x) => ptDate(new Date(x.logged_at)) === today)) {
  if (s.positions.some((p: any) => p.market === f.market_id) || s.closed.some((p: any) => p.market === f.market_id)) continue;
  if (f.best_side === null || f.edge_after_fees_pp === null || f.edge_after_fees_pp < rules.min_edge_pp) continue;
  if (s.positions.length >= rules.max_open_positions) break;
  if (!f.resolves_at || daysUntil(f.resolves_at) > rules.max_days_to_resolution) continue;
  if (exclusionHits(rules, [f.question, f.q_question]).length) continue;
  const price = f.best_side === 'YES' ? f.ask : f.bid === null ? null : r4(1 - f.bid);
  if (price === null || !(price > 0 && price < 1)) continue;
  const unit = price + takerFeePerContract(rules, price);
  const contracts = Math.floor((STAKE / unit) * 100) / 100;
  const cost = r2(contracts * unit);
  if (s.cash < cost || spentToday + cost > rules.daily_entry_limit_usd) continue;
  s.cash = r2(s.cash - cost);
  spentToday += cost;
  const p = { market: f.market_id, side: f.best_side, contracts, price, cost, entered: today, q_forecast_id: f.q_forecast_id, q_prob_side: r2(f.best_side === 'YES' ? f.us_prob_yes : 1 - f.us_prob_yes) };
  s.positions.push(p);
  entries.push(p);
}

// 3. Mark to market and record today's value.
let value = 0;
for (const p of s.positions) {
  const q = await pm.quote(p.market).catch(() => null);
  const mark = !q ? null : p.side === 'YES' ? q.bestBid : q.bestAsk === null ? null : r4(1 - q.bestAsk);
  p.mark = mark;
  value += mark === null ? p.cost : p.contracts * mark; // unpriced positions held at cost
}
const nav = r2(s.cash + value);
s.series = s.series.filter((r: any) => r.date !== today);
s.series.push({ date: today, nav, cash: s.cash, open_positions: s.positions.length });
s.series.sort((a: any, b: any) => a.date.localeCompare(b.date));
writeFileSync(path, JSON.stringify(s, null, 2) + '\n');
console.log(JSON.stringify({ date: today, nav, cash: s.cash, open: s.positions.length, entered_today: entries.length, settled_total: s.closed.length }));
