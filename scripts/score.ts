// Scorecard (CLAUDE.md, Benchmarks: calibration). For every market in data/forecasts.jsonl, checks Polymarket US
// settlement and writes data/scorecard.json: resolved outcomes and Brier scores for Q, the market price at log
// time (bid/ask midpoint), and the agent's own probability wherever it differed from Q. It also reports
// STRATEGY.md section 8's reopening criteria for each category group.
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

// STRATEGY.md section 8 groups, from Polymarket US's market category.
function groupOf(category: string): string {
  if (category === 'sports') return 'sports';
  if (category === 'politics' || category === 'geopolitics') return 'politics';
  if (category === 'macro') return 'economics';
  if (['finance', 'crypto', 'commodities'].includes(category)) return 'finance';
  return 'other';
}
const categories = new Map<string, string>();
const groupFor = async (slug: string) => {
  if (!categories.has(slug)) categories.set(slug, (await pm.market(slug).catch(() => null))?.category ?? '');
  return groupOf(categories.get(slug)!);
};
const resolved = [];
for (const [market, f] of first) {
  const st = await pm.settlement(market).catch(() => null);
  if (!st) continue;
  const mid = f.bid !== null && f.ask !== null ? (f.bid + f.ask) / 2 : null;
  resolved.push({ market, group: await groupFor(market), question: f.question, settled_at: st.settledAt, outcome: st.price, q_prob: r4(f.us_prob_yes), market_prob: mid === null ? null : r4(mid), agent_prob: agentProb.get(market) ?? null });
}

const brier = (pairs: Array<[number | null, number]>) => {
  const xs = pairs.filter(([p]) => p !== null) as Array<[number, number]>;
  return xs.length ? { n: xs.length, score: r4(xs.reduce((s, [p, o]) => s + (p - o) ** 2, 0) / xs.length) } : { n: 0, score: null };
};
// Section 8, criterion 2: 90% paired bootstrap lower bound for (market Brier - Q Brier). Seeded, so reruns agree.
function bootstrapLower(pairs: Array<[number, number, number]>, draws = 2000): number | null {
  if (pairs.length < 2) return null;
  let seed = 7;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const diffs = pairs.map(([q, m, o]) => (m - o) ** 2 - (q - o) ** 2);
  const means = Array.from({ length: draws }, () => {
    let s = 0;
    for (let i = 0; i < diffs.length; i++) s += diffs[Math.floor(rand() * diffs.length)];
    return s / diffs.length;
  }).sort((a, b) => a - b);
  return r4(means[Math.floor(draws * 0.05)]);
}

const shadow = existsSync(`${DATA_DIR}/shadow.json`) ? JSON.parse(readFileSync(`${DATA_DIR}/shadow.json`, 'utf8')) : { closed: [] };
const shadowByGroup = new Map<string, { settled: number; pnl: number }>();
for (const c of shadow.closed ?? []) {
  const g = await groupFor(c.market);
  const cur = shadowByGroup.get(g) ?? { settled: 0, pnl: 0 };
  shadowByGroup.set(g, { settled: cur.settled + 1, pnl: r4(cur.pnl + (c.pnl ?? 0)) });
}
const reopening: Record<string, unknown> = {};
for (const g of ['politics', 'economics', 'finance', 'other', 'sports']) {
  const rows = resolved.filter((r) => r.group === g && r.market_prob !== null);
  const qB = brier(rows.map((r) => [r.q_prob, r.outcome]));
  const mB = brier(rows.map((r) => [r.market_prob, r.outcome]));
  const lower = bootstrapLower(rows.map((r) => [r.q_prob, r.market_prob as number, r.outcome]));
  const sh = shadowByGroup.get(g) ?? { settled: 0, pnl: 0 };
  reopening[g] = {
    resolved: rows.length,
    q_brier: qB.score,
    market_brier: mB.score,
    bootstrap_lower_market_minus_q: lower,
    shadow_settled: sh.settled,
    shadow_pnl: sh.pnl,
    criteria_met: {
      resolved_40: rows.length >= 40,
      q_beats_market: qB.score !== null && mB.score !== null && qB.score < mB.score && lower !== null && lower > 0,
      shadow_15_profitable: sh.settled >= 15 && sh.pnl > 0,
      ...(g === 'sports' ? { quotient_quality_not_insufficient: null } : {}), // checked by the agent from Q's quality field
    },
  };
}

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
  reopening,
};
writeFileSync(`${DATA_DIR}/scorecard.json`, JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify({ logged_markets: out.logged_markets, resolved: resolved.length, brier: out.brier, reopening }, null, 2));
