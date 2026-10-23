// The hard rules (CLAUDE.md mandate rules 3-12, STOP) as pure checks. scripts/execute.ts runs every
// proposal through checkProposal() and refuses to send anything that fails, whatever the agent asked for.
import type { MarketSummary, Quote } from './polymarket.ts';
import { type Rules, exclusionHits, takerFeePerContract } from './rules.ts';
import { daysUntil, endOfPtDay } from './time.ts';

export type Side = 'YES' | 'NO';

export interface Proposal {
  action: 'entry' | 'exit';
  market_id: string; // Polymarket US market slug
  side: Side; // the side bought (entry) or sold (exit)
  limit_price: number; // price of that side in dollars (a NO price for NO)
  quantity: number; // contracts
  q_prob_us_yes?: number | null; // Q's probability that this US contract resolves YES (after orientation)
  q_forecast_id?: string | null;
  q_created_at?: string | null;
  q_market_key?: string | null;
  q_venue?: string | null;
  q_market_odds_at_forecast?: number | null;
  match?: unknown;
  agent_prob?: number | null; // the agent's own estimate that the US contract resolves YES
  rationale: string;
  exit_condition?: string;
}

export interface HeldPosition {
  slug: string;
  side: Side;
  contracts: number;
  cost: number;
}

export interface RestingOrder {
  slug: string;
  action: 'entry' | 'exit';
  side: Side;
  price: number; // price of that side
  remaining: number; // contracts not yet filled
}

export interface Context {
  now: Date;
  stopFile: boolean;
  nav: number;
  buyingPower: number;
  positions: HeldPosition[];
  openOrders: RestingOrder[];
  enteredTodayUsd: number; // new-entry dollars already sent today (Pacific time)
  market: MarketSummary | null;
  quote: Quote | null;
}

export interface Violation {
  rule: string; // 'STOP', 'R4'...'R12', or 'market', 'price', 'quantity', 'cash', 'input'
  message: string;
}

const EPS = 1e-9;
const onStep = (x: number, step: number) => Math.abs(x / step - Math.round(x / step)) < 1e-6;

// Best prices for one side of a binary contract. Buying NO means selling YES, so NO's ask is 1 - YES bid.
export function sideQuote(q: Quote | null, side: Side): { bid: number | null; ask: number | null } {
  if (!q) return { bid: null, ask: null };
  if (side === 'YES') return { bid: q.bestBid, ask: q.bestAsk };
  return { bid: q.bestAsk === null ? null : 1 - q.bestAsk, ask: q.bestBid === null ? null : 1 - q.bestBid };
}

export function entryCost(rules: Rules, p: Proposal): number {
  return p.quantity * (p.limit_price + takerFeePerContract(rules, p.limit_price));
}

export function edgeAfterFeesPp(rules: Rules, p: Proposal): number | null {
  if (typeof p.q_prob_us_yes !== 'number') return null;
  const pSide = p.side === 'YES' ? p.q_prob_us_yes : 1 - p.q_prob_us_yes;
  return Math.round((pSide - p.limit_price - takerFeePerContract(rules, p.limit_price)) * 1000) / 10;
}

export function checkProposal(rules: Rules, p: Proposal, ctx: Context): Violation[] {
  const v: Violation[] = [];
  const add = (rule: string, message: string) => v.push({ rule, message });

  // Kill switch: nothing goes out, entries or exits.
  if (ctx.stopFile) add('STOP', `A ${rules.kill_switch_file} file exists in the repo root; every order is rejected.`);

  // Shape of the request.
  if (p.action !== 'entry' && p.action !== 'exit') add('input', `Unknown action "${p.action}".`);
  if (p.side !== 'YES' && p.side !== 'NO') add('input', `Unknown side "${p.side}".`);
  if (!(p.limit_price > 0 && p.limit_price < 1)) add('price', `Limit price ${p.limit_price} must be between 0 and 1.`);
  if (!(p.quantity > 0)) add('quantity', `Quantity ${p.quantity} must be positive.`);
  if (v.length) return v;

  // The market must exist and be open for trading.
  const m = ctx.market;
  if (!m) return [...v, { rule: 'market', message: `Market ${p.market_id} was not found on Polymarket US.` }];
  if (!m.active || m.closed || (ctx.quote && ctx.quote.state !== 'MARKET_STATE_OPEN')) add('market', `Market ${p.market_id} is not open (${ctx.quote?.state ?? m.status}).`);
  if (m.tickSize && !onStep(p.limit_price, m.tickSize)) add('price', `Limit price ${p.limit_price} is not on the ${m.tickSize} tick.`);
  const step = m.minTradeQty !== null && m.minTradeQty < 1 ? m.minTradeQty : 1;
  if (m.minTradeQty !== null && p.quantity + EPS < m.minTradeQty) add('quantity', `Quantity ${p.quantity} is below the market minimum of ${m.minTradeQty}.`);
  if (!onStep(p.quantity, step)) add('quantity', `Quantity ${p.quantity} is not a multiple of ${step}.`);

  // R7: limit orders only, never more than $0.02 through the best price.
  const sq = sideQuote(ctx.quote, p.side);
  if (p.action === 'entry') {
    if (sq.ask === null) add('R7', `No ask for ${p.side}; cannot bound the limit price.`);
    else if (p.limit_price > sq.ask + rules.max_cross_usd + EPS) add('R7', `Limit ${p.limit_price} is more than $${rules.max_cross_usd} above the best ${p.side} ask ${sq.ask.toFixed(3)}.`);
  } else {
    if (sq.bid === null) add('R7', `No bid for ${p.side}; cannot bound the limit price.`);
    else if (p.limit_price < sq.bid - rules.max_cross_usd - EPS) add('R7', `Limit ${p.limit_price} is more than $${rules.max_cross_usd} below the best ${p.side} bid ${sq.bid.toFixed(3)}.`);
  }

  const held = ctx.positions.find((x) => x.slug === p.market_id);

  if (p.action === 'exit') {
    // R11: an exit may only sell what is held (selling more would open a short).
    const pendingExits = ctx.openOrders.filter((o) => o.slug === p.market_id && o.action === 'exit' && o.side === p.side).reduce((s, o) => s + o.remaining, 0);
    if (!held || held.side !== p.side) add('R11', `No ${p.side} position in ${p.market_id} to sell.`);
    else if (p.quantity > held.contracts - pendingExits + EPS) add('R11', `Selling ${p.quantity} exceeds the ${held.contracts - pendingExits} ${p.side} contracts available.`);
    return v;
  }

  // Entries only from here.
  // R11: no entry on the opposite side of a holding or resting entry (it would net against it, not open a new position).
  if (held && held.side !== p.side) add('R11', `Holding ${held.side} in ${p.market_id}; an entry on ${p.side} would net against it. Use an exit.`);
  else if (ctx.openOrders.some((o) => o.slug === p.market_id && o.action === 'entry' && o.side !== p.side)) add('R11', `A ${p.side === 'YES' ? 'NO' : 'YES'} entry order is already resting in ${p.market_id}.`);

  // R9: drawdown halt.
  if (ctx.nav < rules.drawdown_halt_nav_usd) add('R9', `NAV $${ctx.nav.toFixed(2)} is below the $${rules.drawdown_halt_nav_usd} drawdown halt; new entries are stopped.`);

  // R10: exclusions.
  const hits = exclusionHits(rules, [m.question, m.title, m.description, m.slug, ...m.teams]);
  if (hits.length) add('R10', `Excluded market (matched: ${hits.join(', ')}).`);

  // R12: horizon.
  if (!m.endDate) add('R12', 'Resolution date unknown; entries need a known date.');
  else {
    const days = daysUntil(m.endDate, ctx.now);
    if (days < 0) add('R12', `Market end date ${m.endDate} has passed.`);
    else if (days > rules.max_days_to_resolution) add('R12', `Resolves in ${Math.ceil(days)} days, beyond the ${rules.max_days_to_resolution}-day horizon.`);
  }

  // R6: minimum edge after fees, against Q's probability.
  const edge = edgeAfterFeesPp(rules, p);
  if (edge === null) add('R6', 'Entries need q_prob_us_yes (Q\'s probability for this contract).');
  else if (edge + EPS < rules.min_edge_pp) add('R6', `Edge ${edge}pp after fees is below the ${rules.min_edge_pp}pp minimum.`);

  const cost = entryCost(rules, p);
  const restingInMarket = ctx.openOrders.filter((o) => o.slug === p.market_id && o.action === 'entry').reduce((s, o) => s + o.remaining * o.price, 0);

  // R4: position cap, counting what is already held or resting in this market.
  const cap = (rules.position_cap_pct_nav / 100) * ctx.nav;
  const exposure = (held ? Math.abs(held.cost) : 0) + restingInMarket + cost;
  if (exposure > cap + EPS) add('R4', `Exposure $${exposure.toFixed(2)} in this market would exceed the ${rules.position_cap_pct_nav}% cap of $${cap.toFixed(2)}.`);

  // R5: open positions, counting markets with resting entry orders.
  const occupied = new Set([...ctx.positions.map((x) => x.slug), ...ctx.openOrders.filter((o) => o.action === 'entry').map((o) => o.slug)]);
  if (!occupied.has(p.market_id) && occupied.size >= rules.max_open_positions) add('R5', `Already ${occupied.size} open positions; the limit is ${rules.max_open_positions}.`);

  // R8: daily entry limit (Pacific time).
  if (ctx.enteredTodayUsd + cost > rules.daily_entry_limit_usd + EPS) add('R8', `Entries today would reach $${(ctx.enteredTodayUsd + cost).toFixed(2)}, over the $${rules.daily_entry_limit_usd} daily limit.`);

  // Cash: no leverage (R11), so the order must fit in buying power.
  if (cost > ctx.buyingPower + EPS) add('cash', `Cost $${cost.toFixed(2)} exceeds buying power $${ctx.buyingPower.toFixed(2)}.`);

  return v;
}

export const INTENTS = {
  entry: { YES: 'ORDER_INTENT_BUY_LONG', NO: 'ORDER_INTENT_BUY_SHORT' },
  exit: { YES: 'ORDER_INTENT_SELL_LONG', NO: 'ORDER_INTENT_SELL_SHORT' },
} as const;

// Exchange prices refer to YES. A NO order at NO price x is sent as YES price 1 - x.
export function exchangePrice(p: Proposal): number {
  return p.side === 'YES' ? p.limit_price : Math.round((1 - p.limit_price) * 10000) / 10000;
}

// The order the executor sends: always a limit (R7), expiring at the end of the Pacific day.
export function buildOrder(p: Proposal, now = new Date()) {
  return {
    marketSlug: p.market_id,
    intent: INTENTS[p.action][p.side],
    type: 'ORDER_TYPE_LIMIT' as const,
    price: { value: exchangePrice(p).toFixed(4), currency: 'USD' as const },
    quantity: p.quantity,
    tif: 'TIME_IN_FORCE_GOOD_TILL_DATE' as const,
    goodTillTime: endOfPtDay(now),
    manualOrderIndicator: 'MANUAL_ORDER_INDICATOR_AUTOMATIC' as const,
  };
}
