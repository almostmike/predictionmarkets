// Scorecard (CLAUDE.md, Benchmarks: calibration). For every market in data/forecasts.jsonl, checks Polymarket US
// settlement and writes data/scorecard.json: resolved outcomes and Brier scores for Q, the market price at log
// time (bid/ask midpoint), and the agent's own probability wherever it differed from Q.
//   node scripts/score.ts
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { DATA_DIR } from './lib/env.ts';
import { createReadOnlyClient } from './lib/polymarket.ts';

const read = (f: string) => (existsSync(`${DATA_DIR}/${f}`) ? readFileSync(`${DATA_DIR}/${f}`, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const forecasts = read('forecasts.jsonl');
const decisions = read('decisions.jsonl');
const pm = createReadOnlyClient({});

// The first logged forecast per market is the one scored (the prediction made before the outcome was known).
const first = new Map<string, any>();
for (const f of forecasts) if (!first.has(f.market_id)) first.set(f.market_id, f);
const agentProb = new Map<string, number>();
for (const d of decisions) if (typeof d.agent_prob === 'number' && !agentProb.has(d.market_id)) agentProb.set(d.market_id, d.agent_prob);

const r4 = (x: number) => Math.round(x * 10000) / 10000;
const resolved = [];
for (const [market, f] of first) {
  const st = await pm.settlement(market).catch(() => null);
  if (!st) continue;
  const mid = f.bid !== null && f.ask !== null ? (f.bid + f.ask) / 2 : null;
  resolved.push({ market, question: f.question, settled_at: st.settledAt, outcome: st.price, q_prob: r4(f.us_prob_yes), market_prob: mid === null ? null : r4(mid), agent_prob: agentProb.get(market) ?? null });
}

const brier = (pairs: Array<[number | null, number]>) => {
  const xs = pairs.filter(([p]) => p !== null) as Array<[number, number]>;
  return xs.length ? { n: xs.length, score: r4(xs.reduce((s, [p, o]) => s + (p - o) ** 2, 0) / xs.length) } : { n: 0, score: null };
};
const differs = resolved.filter((r) => r.agent_prob !== null && Math.abs(r.agent_prob - r.q_prob) > 1e-6);
const out = {
  as_of: new Date().toISOString(),
  logged_markets: first.size,
  resolved,
  brier: {
    q: brier(resolved.map((r) => [r.q_prob, r.outcome])),
    market: brier(resolved.map((r) => [r.market_prob, r.outcome])),
    agent_where_it_differs: brier(differs.map((r) => [r.agent_prob, r.outcome])),
    q_on_same_markets: brier(differs.map((r) => [r.q_prob, r.outcome])),
  },
};
writeFileSync(`${DATA_DIR}/scorecard.json`, JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify({ logged_markets: out.logged_markets, resolved: resolved.length, brier: out.brier }));
