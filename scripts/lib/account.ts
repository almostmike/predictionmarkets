// One reconciled view of the account, shared by scripts/reconcile.ts and scripts/execute.ts.
// The broker is the source of truth; only sanitized fields come out (no account IDs).
import type { HeldPosition, RestingOrder, Side } from './guardrails.ts';
import { type OpenOrder, type ReadOnlyPolymarket, markPosition } from './polymarket.ts';

export interface PositionRow extends HeldPosition {
  title: string;
  avgCost: number | null;
  mark: number | null; // price the side could be sold at now
  value: number | null; // contracts x mark
  resolvesAt: string | null;
}

export interface Snapshot {
  asOf: string;
  cash: number; // broker currentBalance (includes proceeds of YES sold to open NO positions)
  buyingPower: number;
  positions: PositionRow[];
  openOrders: RestingOrder[];
  nav: number;
  unmarked: string[]; // positions without a price: NAV is incomplete and nothing should trade
}

const round = (n: number, d = 4) => Math.round(n * 10 ** d) / 10 ** d;

// Open orders as the guardrails see them. Prices on the exchange refer to YES, so a NO order's price is 1 - YES price.
export function toResting(o: OpenOrder): RestingOrder | null {
  const intent = o.intent.toUpperCase();
  const side: Side = intent.includes('SHORT') ? 'NO' : 'YES';
  const action = intent.includes('BUY_LONG') || intent.includes('BUY_SHORT') ? 'entry' : intent.includes('SELL') ? 'exit' : null;
  if (!action || o.price === null) return null;
  const price = side === 'YES' ? o.price : Math.round((1 - o.price) * 10000) / 10000;
  return { slug: o.slug, action, side, price, remaining: Math.max(0, o.quantity - o.filled) };
}

// NAV = cash + value of held contracts - $1 per NO contract.
// Opening NO sells YES: the sale proceeds land in cash and $1 per contract is owed at settlement,
// so the NO side's value (1 - YES ask) is counted against that $1 obligation.
export function navOf(cash: number, positions: Array<{ side: Side; contracts: number; value: number | null }>): number {
  return round(cash + positions.reduce((s, p) => s + (p.value ?? 0) - (p.side === 'NO' ? p.contracts : 0), 0), 2);
}

export async function snapshot(pm: ReadOnlyPolymarket): Promise<Snapshot> {
  const [balance, positions, orders] = await Promise.all([pm.balance(), pm.positions(), pm.openOrders()]);
  const open = positions.filter((p) => p.netContracts !== 0 && !p.expired);
  const quotes = await Promise.all(open.map((p) => pm.quote(p.slug).catch(() => null)));
  const meta = await Promise.all(open.map((p) => pm.market(p.slug).catch(() => null)));
  const rows: PositionRow[] = open.map((p, i) => {
    const contracts = Math.abs(p.netContracts);
    const mark = markPosition(p, quotes[i]);
    return {
      slug: p.slug,
      title: meta[i]?.question || p.title,
      side: p.netContracts > 0 ? 'YES' : 'NO',
      contracts: round(contracts),
      cost: round(Math.abs(p.cost), 2),
      avgCost: contracts ? round(Math.abs(p.cost) / contracts) : null,
      mark,
      value: mark === null ? null : round(mark * contracts, 2),
      resolvesAt: meta[i]?.endDate ?? null,
    };
  });
  return {
    asOf: new Date().toISOString(),
    cash: round(balance.currentBalance, 2),
    buyingPower: round(balance.buyingPower, 2),
    positions: rows,
    openOrders: orders.map(toResting).filter((o): o is RestingOrder => o !== null),
    nav: navOf(balance.currentBalance, rows),
    unmarked: rows.filter((r) => r.value === null).map((r) => r.slug),
  };
}
