// Read-only account sync (daily session step 1). The broker is the source of truth.
// Writes data/positions.json and upserts today's row in data/nav.json.
// Only sanitized fields are written: no account IDs, keys, or raw responses.
import { readFileSync, writeFileSync } from 'node:fs';
import { ROOT, loadEnv } from './lib/env.ts';
import { createReadOnlyClient, markPosition } from './lib/polymarket.ts';
import { ptDate } from './lib/time.ts';

loadEnv();
const pm = createReadOnlyClient();
if (!pm.authenticated) {
  console.error('reconcile: Polymarket US keys are not set in .env. Nothing reconciled; do not trade.');
  process.exit(2);
}

const round = (n: number, d = 4) => Math.round(n * 10 ** d) / 10 ** d;

const [balance, positions, openOrders] = await Promise.all([pm.balance(), pm.positions(), pm.openOrders()]);
const open = positions.filter((p) => p.netContracts !== 0 && !p.expired);
const quotes = await Promise.all(open.map((p) => pm.quote(p.slug).catch(() => null)));
const meta = await Promise.all(open.map((p) => pm.market(p.slug).catch(() => null)));

const rows = open.map((p, i) => {
  const mark = markPosition(p, quotes[i]);
  const contracts = Math.abs(p.netContracts);
  return {
    market: p.slug,
    question: meta[i]?.question || p.title,
    side: p.netContracts > 0 ? 'YES' : 'NO',
    contracts: round(contracts),
    avg_cost: contracts ? round(p.cost / contracts) : null,
    cost: round(p.cost, 2),
    mark,
    value: mark === null ? null : round(mark * contracts, 2),
    resolves_at: meta[i]?.endDate ?? null,
  };
});

const unmarked = rows.filter((r) => r.value === null).map((r) => r.market);
const positionsValue = rows.reduce((s, r) => s + (r.value ?? 0), 0);
const now = new Date();
const date = ptDate(now);
const nav = round(balance.currentBalance + positionsValue, 2);

writeFileSync(
  `${ROOT}data/positions.json`,
  JSON.stringify({ as_of: now.toISOString(), cash: round(balance.currentBalance, 2), buying_power: round(balance.buyingPower, 2), open_orders: openOrders.length, positions: rows, unmarked }, null, 2) + '\n',
);

const navPath = `${ROOT}data/nav.json`;
const navFile = JSON.parse(readFileSync(navPath, 'utf8'));
navFile.series = (navFile.series ?? []).filter((r: { date: string }) => r.date !== date);
navFile.series.push({ date, nav, cash: round(balance.currentBalance, 2), positions_value: round(positionsValue, 2), open_positions: rows.length });
navFile.series.sort((a: { date: string }, b: { date: string }) => a.date.localeCompare(b.date));
writeFileSync(navPath, JSON.stringify(navFile, null, 2) + '\n');

console.log(JSON.stringify({ date, nav, cash: balance.currentBalance, open_positions: rows.length, open_orders: openOrders.length, unmarked }));
if (unmarked.length) process.exitCode = 3; // a position without a price means NAV is incomplete: do not trade
