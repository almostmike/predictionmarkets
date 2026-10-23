// Read-only account sync (daily session step 1). The broker is the source of truth.
// Writes data/positions.json and upserts today's row in data/nav.json.
// Only sanitized fields are written: no account IDs, keys, or raw responses.
import { readFileSync, writeFileSync } from 'node:fs';
import { DATA_DIR, isDryRun, loadEnv } from './lib/env.ts';
import { createReadOnlyClient } from './lib/polymarket.ts';
import { snapshot } from './lib/account.ts';
import { ptDate } from './lib/time.ts';

loadEnv();
const pm = createReadOnlyClient();
if (!pm.authenticated) {
  console.error('reconcile: Polymarket US keys are not set in .env. Nothing reconciled; do not trade.');
  process.exit(2);
}

const [snap, fills] = await Promise.all([snapshot(pm), pm.fills()]);

// Fills into data/trades.json, newest first, one row per exchange trade ID. Busted or rejected trades are dropped.
const tradesPath = `${DATA_DIR}/trades.json`;
const known = new Map<string, unknown>((JSON.parse(readFileSync(tradesPath, 'utf8')) as Array<{ trade_id: string }>).map((t) => [t.trade_id, t]));
const dropped = new Set<string>();
for (const f of fills) {
  if (/BUSTED|REJECTED/.test(f.state)) dropped.add(f.trade_id);
  else known.set(f.trade_id, f);
}
const trades = [...known.entries()].filter(([id]) => !dropped.has(id)).map(([, t]) => t).sort((a: any, b: any) => String(b.time).localeCompare(String(a.time)));
writeFileSync(tradesPath, JSON.stringify(trades, null, 2) + '\n');
const date = ptDate(new Date(snap.asOf));
const positionsValue = snap.positions.reduce((s, r) => s + (r.value ?? 0), 0);

writeFileSync(
  `${DATA_DIR}/positions.json`,
  JSON.stringify({
    as_of: snap.asOf,
    cash: snap.cash,
    buying_power: snap.buyingPower,
    open_orders: snap.openOrders.length,
    positions: snap.positions.map((r) => ({ market: r.slug, question: r.title, side: r.side, contracts: r.contracts, avg_cost: r.avgCost, cost: r.cost, mark: r.mark, value: r.value, resolves_at: r.resolvesAt })),
    unmarked: snap.unmarked,
  }, null, 2) + '\n',
);

const navPath = `${DATA_DIR}/nav.json`;
const navFile = JSON.parse(readFileSync(navPath, 'utf8'));
navFile.series = (navFile.series ?? []).filter((r: { date: string }) => r.date !== date);
navFile.series.push({ date, nav: snap.nav, cash: snap.cash, positions_value: Math.round(positionsValue * 100) / 100, open_positions: snap.positions.length, dry_run: isDryRun() });
navFile.series.sort((a: { date: string }, b: { date: string }) => a.date.localeCompare(b.date));
writeFileSync(navPath, JSON.stringify(navFile, null, 2) + '\n');

console.log(JSON.stringify({ date, nav: snap.nav, cash: snap.cash, buying_power: snap.buyingPower, open_positions: snap.positions.length, open_orders: snap.openOrders.length, fills: trades.length, unmarked: snap.unmarked }));
if (snap.unmarked.length) process.exitCode = 3; // a position without a price means NAV is incomplete: do not trade
