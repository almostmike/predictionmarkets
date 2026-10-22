// Public market data, no keys needed.
//   node scripts/markets.ts            coverage summary of active markets
//   node scripts/markets.ts <slug>     one market: details, best bid/ask, top of book
import { createReadOnlyClient } from './lib/polymarket.ts';
import { loadRules } from './lib/rules.ts';
import { daysUntil } from './lib/time.ts';

const pm = createReadOnlyClient({});
const slug = process.argv[2];

if (slug) {
  const [market, quote, book] = await Promise.all([pm.market(slug), pm.quote(slug), pm.book(slug)]);
  console.log(JSON.stringify({ market: { ...market, description: market.description.slice(0, 300) }, quote, top: { bids: book.bids.slice(0, 3), offers: book.offers.slice(0, 3) } }, null, 2));
} else {
  const rules = loadRules();
  const markets = await pm.listMarkets();
  const inWindow = markets.filter((m) => m.endDate && daysUntil(m.endDate) >= 0 && daysUntil(m.endDate) <= rules.max_days_to_resolution);
  const byCategory = (ms: typeof markets) =>
    Object.fromEntries(Object.entries(Object.groupBy(ms, (m) => m.category || 'none')).map(([k, v]) => [k, v!.length]).sort((a, b) => (b[1] as number) - (a[1] as number)));
  console.log(JSON.stringify({ active: markets.length, by_category: byCategory(markets), within_horizon_days: rules.max_days_to_resolution, within_horizon: inWindow.length, within_horizon_by_category: byCategory(inWindow) }, null, 2));
}
