// Daily session step 2: review each held market against Q's latest forecast.
//   node scripts/holdings.ts
// Reads data/positions.json (written by reconcile) and the match that led to each holding in
// data/forecasts.jsonl, re-reads Q (about $0.01 per 10 holdings), and prints one line per holding
// with flags the agent weighs against its exit conditions. Writes nothing public.
import { existsSync, readFileSync } from 'node:fs';
import { DATA_DIR } from './lib/env.ts';
import { createReadOnlyClient } from './lib/polymarket.ts';
import { forecasts, preflight } from './lib/quotient.ts';

const positions: Array<{ market: string; side: 'YES' | 'NO'; contracts: number; avg_cost: number | null; mark: number | null }> =
  JSON.parse(readFileSync(`${DATA_DIR}/positions.json`, 'utf8')).positions ?? [];
if (!positions.length) {
  console.log(JSON.stringify({ holdings: 0, note: 'No open positions to review.' }));
  process.exit(0);
}

// The most recent match logged for each US market: which Q contract it tracks, and its orientation.
const matches = new Map<string, any>();
const fpath = `${DATA_DIR}/forecasts.jsonl`;
if (existsSync(fpath)) for (const line of readFileSync(fpath, 'utf8').split('\n').filter(Boolean)) {
  const r = JSON.parse(line);
  matches.set(r.market_id, r);
}

const pm = createReadOnlyClient({});
await preflight();
const keys = [...new Set(positions.map((p) => matches.get(p.market)?.q_market_key).filter(Boolean))];
const latest = new Map((await forecasts(keys)).map((f) => [f.marketKey, f]));

const rows = [];
for (const p of positions) {
  const m = matches.get(p.market);
  const f = m ? latest.get(m.q_market_key) : undefined;
  const settlement = await pm.settlement(p.market).catch(() => null);
  const qUsYes = f ? (m.match?.orientation === 'flipped' ? 1 - f.prob : f.prob) : null;
  const qSide = qUsYes === null ? null : p.side === 'YES' ? qUsYes : 1 - qUsYes;
  const flags = [];
  if (!m) flags.push('no_logged_match');
  else if (!f) flags.push('q_forecast_missing');
  if (qSide !== null && qSide < 0.5) flags.push('q_flipped'); // Q no longer favors the side held
  if (qSide !== null && p.mark !== null && qSide - p.mark < 0) flags.push('edge_gone');
  if (f?.forecastState === 'warning' || f?.forecastState === 'caution') flags.push(`forecast_status_${f.forecastState}`);
  if (settlement) flags.push(`settled_${settlement.price}`);
  rows.push({ market: p.market, side: p.side, contracts: p.contracts, avg_cost: p.avg_cost, mark: p.mark, q_side_prob: qSide === null ? null : Math.round(qSide * 1000) / 1000, q_forecast_id: f?.forecastId ?? null, q_created_at: f?.createdAt ?? null, flags });
}
console.log(JSON.stringify({ holdings: rows.length, rows }, null, 2));
