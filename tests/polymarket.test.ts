import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createReadOnlyClient, markPosition, toBalance, toMarketSummary, toPosition, toQuote } from '../scripts/lib/polymarket.ts';

test('read-only client source cannot place or cancel orders', () => {
  const src = readFileSync(new URL('../scripts/lib/polymarket.ts', import.meta.url), 'utf8');
  for (const forbidden of ['.post(', '.delete(', 'orders.create', 'orders.cancel', 'orders.modify', 'closePosition', "'POST'", "'DELETE'"]) {
    assert.ok(!src.includes(forbidden), `found ${forbidden}`);
  }
  const pm = createReadOnlyClient({});
  for (const name of ['create', 'cancel', 'modify', 'orders', 'post', 'delete']) assert.ok(!(name in pm), `exposes ${name}`);
});

test('account reads refuse to run without keys', async () => {
  const pm = createReadOnlyClient({ keyId: '', secretKey: '' });
  assert.equal(pm.authenticated, false);
  await assert.rejects(pm.balance(), /keys are not set/);
  await assert.rejects(pm.positions(), /keys are not set/);
});

test('normalizes live-shaped market and quote payloads', () => {
  const m = toMarketSummary({
    slug: 'x', question: 'World Series Champion', title: 'Milwaukee Brewers', category: 'sports', marketType: 'futures',
    endDate: '2026-11-06T21:20:09Z', active: true, closed: false, status: 'MARKET_STATUS_OPEN', minimumTradeQty: '1',
    orderPriceMinTickSize: 0.001, feeCoefficient: '0.0695', bestBidQuote: { value: '0.6280', currency: 'USD' },
    bestAskQuote: { value: '0.6290', currency: 'USD' }, marketSides: [{ team: { name: 'Milwaukee Brewers' } }, { team: { name: 'Milwaukee Brewers' } }],
  });
  assert.equal(m.bestAsk, 0.629);
  assert.equal(m.minTradeQty, 1);
  assert.deepEqual(m.teams, ['Milwaukee Brewers']);

  const q = toQuote({ marketData: { marketSlug: 'x', state: 'MARKET_STATE_OPEN', bestBid: { value: '0.6280' }, bestAsk: { value: '0.6290' }, lastTradePx: { value: '0.6290' }, bidDepth: 17, askDepth: 18 } });
  assert.deepEqual([q.bestBid, q.bestAsk, q.bidDepth], [0.628, 0.629, 17]);
});

test('normalizes balances and positions; marks YES at bid and NO at 1 - ask', () => {
  assert.equal(toBalance({ balances: [{ currency: 'USD', currentBalance: 97.5, buyingPower: 90 }] }).currentBalance, 97.5);
  const yes = toPosition('a', { netPositionDecimal: '10', cost: { value: '4.00' }, realized: { value: '0' }, expired: false });
  const no = toPosition('b', { netPositionDecimal: '-10', cost: { value: '3.00' }, realized: { value: '0' }, expired: false });
  const quote = { slug: 'a', state: '', bestBid: 0.45, bestAsk: 0.47, lastTrade: null, bidDepth: 1, askDepth: 1 };
  assert.equal(markPosition(yes, quote), 0.45);
  assert.equal(markPosition(no, quote), 1 - 0.47);
  assert.equal(markPosition(yes, null), null);
});

test('live public endpoints (set LIVE=1)', { skip: process.env.LIVE !== '1' }, async () => {
  const pm = createReadOnlyClient({});
  const markets = await pm.listMarkets({ categories: ['geopolitics'] }); // a small category: one page
  assert.ok(markets.length > 0);
  const slug = markets[0].slug;
  const [m, q, b] = await Promise.all([pm.market(slug), pm.quote(slug), pm.book(slug)]);
  assert.equal(m.slug, slug);
  assert.equal(q.slug, slug);
  assert.ok(Array.isArray(b.bids));
});

test('fills come from trade activities only; settlement prices parse', async () => {
  const { toFill } = await import('../scripts/lib/polymarket.ts');
  assert.equal(toFill({ type: 'ACTIVITY_TYPE_ACCOUNT_DEPOSIT', accountBalanceChange: {} }), null);
  const f = toFill({ type: 'ACTIVITY_TYPE_TRADE', trade: { id: 't1', marketSlug: 'm', state: 'TRADE_STATE_CLEARED', createTime: '2026-10-23T16:00:00Z', price: { value: '0.6225' }, qtyDecimal: '12.00', isAggressor: true, realizedPnl: null } })!;
  assert.deepEqual([f.trade_id, f.price, f.contracts, f.taker, f.realized_pnl], ['t1', 0.6225, 12, true, null]);
});
