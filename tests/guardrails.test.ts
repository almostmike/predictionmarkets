import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { type Context, type Proposal, INTENTS, buildOrder, checkProposal, edgeAfterFeesPp, exchangePrice, sideQuote } from '../scripts/lib/guardrails.ts';
import { navOf, toResting } from '../scripts/lib/account.ts';
import { toMarketSummary } from '../scripts/lib/polymarket.ts';
import { loadRules } from '../scripts/lib/rules.ts';

const rules = loadRules();
const NOW = new Date('2026-10-23T16:00:00Z');

const market = (over: Record<string, any> = {}) =>
  toMarketSummary({
    slug: 'aec-nfl-pit-no-2026-10-25', question: 'Who will win: Steelers vs Saints?', title: 'PIT Steelers vs. NO Saints', description: 'Settles to the winner.',
    active: true, closed: false, status: 'MARKET_STATUS_OPEN', endDate: '2026-11-08T18:30:00Z', minimumTradeQty: '1', orderPriceMinTickSize: 0.0025,
    marketSides: [{ description: 'Steelers', long: true, team: { name: 'Pittsburgh Steelers' } }, { description: 'Saints', long: false, team: { name: 'New Orleans Saints' } }],
    ...over,
  });
const quote = { slug: 'aec-nfl-pit-no-2026-10-25', state: 'MARKET_STATE_OPEN', bestBid: 0.6225, bestAsk: 0.625, lastTrade: 0.625, bidDepth: 5, askDepth: 5 };
const ctx = (over: Partial<Context> = {}): Context => ({ now: NOW, stopFile: false, nav: 100, buyingPower: 100, positions: [], openOrders: [], enteredTodayUsd: 0, market: market(), quote, ...over });
// Q says Steelers (US YES) 77%: edge at 0.625 = 77 - 62.5 - 1.63 = 12.9pp. 7 contracts cost $4.49.
const yes = (over: Partial<Proposal> = {}): Proposal => ({ action: 'entry', market_id: 'aec-nfl-pit-no-2026-10-25', side: 'YES', limit_price: 0.625, quantity: 7, q_prob_us_yes: 0.77, rationale: 'test', ...over });
const rulesHit = (p: Proposal, c: Context) => checkProposal(rules, p, c).map((v) => v.rule);

test('a proposal inside every rule passes', () => {
  assert.deepEqual(rulesHit(yes(), ctx()), []);
});

test('STOP: the kill switch rejects entries and exits', () => {
  assert.ok(rulesHit(yes(), ctx({ stopFile: true })).includes('STOP'));
  const held = [{ slug: 'aec-nfl-pit-no-2026-10-25', side: 'YES' as const, contracts: 7, cost: 4.38 }];
  assert.ok(rulesHit(yes({ action: 'exit', limit_price: 0.6225 }), ctx({ stopFile: true, positions: held })).includes('STOP'));
});

test('R4: position cap is 5% of NAV, including held and resting exposure', () => {
  assert.ok(rulesHit(yes({ quantity: 8 }), ctx()).includes('R4')); // $5.13 > $5.00
  assert.deepEqual(rulesHit(yes({ quantity: 7 }), ctx()), []);
  const held = [{ slug: 'aec-nfl-pit-no-2026-10-25', side: 'YES' as const, contracts: 2, cost: 1.2 }];
  assert.ok(rulesHit(yes(), ctx({ positions: held })).includes('R4')); // 1.20 + 4.49
  const resting = [{ slug: 'aec-nfl-pit-no-2026-10-25', action: 'entry' as const, side: 'YES' as const, price: 0.6, remaining: 2 }];
  assert.ok(rulesHit(yes(), ctx({ openOrders: resting })).includes('R4'));
  assert.ok(rulesHit(yes({ quantity: 3 }), ctx({ nav: 30, buyingPower: 30 })).includes('R4')); // cap scales with NAV: $1.50
});

test('R5: at most 15 open positions, counting resting entries; adding to a held market is allowed', () => {
  const fifteen = Array.from({ length: 15 }, (_, i) => ({ slug: `m${i}`, side: 'YES' as const, contracts: 1, cost: 0.1 }));
  assert.ok(rulesHit(yes(), ctx({ positions: fifteen })).includes('R5'));
  const fourteenPlusOrder = { positions: fifteen.slice(0, 14), openOrders: [{ slug: 'x', action: 'entry' as const, side: 'YES' as const, price: 0.1, remaining: 1 }] };
  assert.ok(rulesHit(yes(), ctx(fourteenPlusOrder)).includes('R5'));
  const withThis = [...fifteen.slice(0, 14), { slug: 'aec-nfl-pit-no-2026-10-25', side: 'YES' as const, contracts: 1, cost: 0.5 }];
  assert.ok(!rulesHit(yes({ quantity: 6 }), ctx({ positions: withThis })).includes('R5'));
});

test('R6: minimum 10pp edge after the taker fee, against Q', () => {
  assert.equal(edgeAfterFeesPp(rules, yes()), 12.9);
  assert.ok(rulesHit(yes({ q_prob_us_yes: 0.74 }), ctx()).includes('R6')); // 9.9pp
  assert.ok(rulesHit(yes({ q_prob_us_yes: null }), ctx()).includes('R6'));
  // NO side: Q 40% YES -> 60% NO; NO costs 1 - 0.6225 = 0.3775; edge = 60 - 37.75 - 1.63 = 20.6
  assert.equal(edgeAfterFeesPp(rules, yes({ side: 'NO', limit_price: 0.3775, q_prob_us_yes: 0.4 })), 20.6);
});

test('R7: limit orders only, at most $0.02 through the best price', () => {
  assert.ok(rulesHit(yes({ limit_price: 0.65, q_prob_us_yes: 0.95, quantity: 1 }), ctx()).includes('R7')); // ask + 0.025
  assert.ok(!rulesHit(yes({ limit_price: 0.645, q_prob_us_yes: 0.95, quantity: 1 }), ctx()).includes('R7')); // ask + 0.02
  // NO ask is 1 - YES bid = 0.3775; 0.4 crosses by 0.0225
  assert.ok(rulesHit(yes({ side: 'NO', limit_price: 0.4, q_prob_us_yes: 0.2, quantity: 1 }), ctx()).includes('R7'));
  // exits: no more than $0.02 below the bid
  const held = [{ slug: 'aec-nfl-pit-no-2026-10-25', side: 'YES' as const, contracts: 7, cost: 4.38 }];
  assert.ok(rulesHit(yes({ action: 'exit', limit_price: 0.6 }), ctx({ positions: held })).includes('R7'));
  assert.deepEqual(rulesHit(yes({ action: 'exit', limit_price: 0.6025 }), ctx({ positions: held })), []);
  const order = buildOrder(yes(), NOW);
  assert.equal(order.type, 'ORDER_TYPE_LIMIT');
  assert.equal(order.tif, 'TIME_IN_FORCE_GOOD_TILL_DATE');
  assert.equal(order.goodTillTime, '2026-10-24T06:59:00.000Z'); // 23:59 PT
});

test('R8: at most $25 of new entries per Pacific day', () => {
  assert.ok(rulesHit(yes(), ctx({ enteredTodayUsd: 21 })).includes('R8')); // 21 + 4.49
  assert.ok(!rulesHit(yes(), ctx({ enteredTodayUsd: 20 })).includes('R8'));
});

test('R9: no new entries below $20 NAV; exits still allowed', () => {
  assert.ok(rulesHit(yes({ quantity: 1 }), ctx({ nav: 19.99, buyingPower: 10 })).includes('R9'));
  const held = [{ slug: 'aec-nfl-pit-no-2026-10-25', side: 'YES' as const, contracts: 7, cost: 4.38 }];
  assert.deepEqual(rulesHit(yes({ action: 'exit', limit_price: 0.6225 }), ctx({ nav: 15, positions: held })), []);
});

test('R10: excluded markets are rejected', () => {
  const sdsu = market({ question: 'Who will win: San Diego State vs Fresno State?', marketSides: [{ description: 'Aztecs', long: true, team: { name: 'San Diego State Aztecs' } }, { description: 'Bulldogs', long: false, team: { name: 'Fresno State Bulldogs' } }] });
  assert.ok(rulesHit(yes(), ctx({ market: sdsu })).includes('R10'));
  const mdt = market({ question: 'Will Medtronic beat earnings?', marketSides: [] });
  assert.ok(rulesHit(yes(), ctx({ market: mdt })).includes('R10'));
});

test('R11: no shorting beyond buying NO; exits only sell what is held', () => {
  assert.ok(rulesHit(yes({ action: 'exit', limit_price: 0.6225 }), ctx()).includes('R11'));
  const held = [{ slug: 'aec-nfl-pit-no-2026-10-25', side: 'YES' as const, contracts: 7, cost: 4.38 }];
  assert.ok(rulesHit(yes({ action: 'exit', limit_price: 0.6225, quantity: 8 }), ctx({ positions: held })).includes('R11'));
  assert.ok(rulesHit(yes({ side: 'NO', limit_price: 0.3775, q_prob_us_yes: 0.2, quantity: 1 }), ctx({ positions: held })).includes('R11'));
  const restingYes = [{ slug: 'aec-nfl-pit-no-2026-10-25', action: 'entry' as const, side: 'YES' as const, price: 0.62, remaining: 1 }];
  assert.ok(rulesHit(yes({ side: 'NO', limit_price: 0.3775, q_prob_us_yes: 0.2, quantity: 1 }), ctx({ openOrders: restingYes })).includes('R11'));
  // a pending exit order reduces what can still be sold
  const pendingExit = [{ slug: 'aec-nfl-pit-no-2026-10-25', action: 'exit' as const, side: 'YES' as const, price: 0.63, remaining: 5 }];
  assert.ok(rulesHit(yes({ action: 'exit', limit_price: 0.6225, quantity: 3 }), ctx({ positions: held, openOrders: pendingExit })).includes('R11'));
  // no leverage: cost must fit in buying power
  assert.ok(rulesHit(yes(), ctx({ buyingPower: 4 })).includes('cash'));
  assert.deepEqual(INTENTS.entry, { YES: rules.entry_intents[0], NO: rules.entry_intents[1] });
  assert.deepEqual(INTENTS.exit, { YES: rules.exit_intents[0], NO: rules.exit_intents[1] });
});

test('R12: entries only within 60 days of resolution, with a known date', () => {
  assert.ok(rulesHit(yes(), ctx({ market: market({ endDate: '2026-12-31T00:00:00Z' }) })).includes('R12'));
  assert.ok(rulesHit(yes(), ctx({ market: market({ endDate: null }) })).includes('R12'));
  assert.ok(rulesHit(yes(), ctx({ market: market({ endDate: '2026-10-20T00:00:00Z' }) })).includes('R12'));
  assert.ok(!rulesHit(yes(), ctx({ market: market({ endDate: '2026-12-21T00:00:00Z' }) })).includes('R12')); // 59 days
});

test('market state, tick, and quantity step are enforced', () => {
  assert.ok(rulesHit(yes(), ctx({ market: null })).includes('market'));
  assert.ok(rulesHit(yes(), ctx({ quote: { ...quote, state: 'MARKET_STATE_HALTED' } })).includes('market'));
  assert.ok(rulesHit(yes({ limit_price: 0.6251 }), ctx()).includes('price'));
  assert.ok(rulesHit(yes({ quantity: 6.5 }), ctx()).includes('quantity'));
  assert.ok(!rulesHit(yes({ quantity: 6.5 }), ctx({ market: market({ minimumTradeQty: '0.01' }) })).includes('quantity'));
  assert.ok(rulesHit(yes({ limit_price: 1.2 }), ctx()).includes('price'));
});

test('NO orders go to the exchange as YES prices; resting NO orders come back as NO prices', () => {
  // Verified with the exchange preview on 2026-10-22: BUY_SHORT at 0.6225 = sell YES at 0.6225 = buy NO at 0.3775.
  const no = yes({ side: 'NO', limit_price: 0.3775 });
  assert.equal(exchangePrice(no), 0.6225);
  assert.equal(buildOrder(no, NOW).intent, 'ORDER_INTENT_BUY_SHORT');
  assert.equal(buildOrder(no, NOW).price.value, '0.6225');
  assert.deepEqual(toResting({ id: 'o', slug: 's', intent: 'ORDER_INTENT_BUY_SHORT', type: 'ORDER_TYPE_LIMIT', price: 0.6225, quantity: 12, filled: 2 }), { slug: 's', action: 'entry', side: 'NO', price: 0.3775, remaining: 10 });
  assert.deepEqual(sideQuote(quote, 'NO'), { bid: 1 - 0.625, ask: 1 - 0.6225 });
});

test('NAV counts the $1 owed on each NO contract', () => {
  // Buy 10 NO at 0.40 = sell 10 YES at 0.60: cash 100 -> 106; NO marked at 1 - ask 0.60 = 0.40 -> value 4.
  assert.equal(navOf(106, [{ side: 'NO', contracts: 10, value: 4 }]), 100);
  assert.equal(navOf(94, [{ side: 'YES', contracts: 10, value: 6 }]), 100);
});

test('only scripts/execute.ts can place or preview orders', () => {
  const files = ['scripts', 'scripts/lib'].flatMap((d) => readdirSync(new URL(`../${d}/`, import.meta.url)).filter((f) => f.endsWith('.ts')).map((f) => `${d}/${f}`));
  for (const f of files) {
    if (f === 'scripts/execute.ts') continue;
    const src = readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
    for (const forbidden of ['orders.create', 'orders.preview', 'orders.cancel', 'orders.modify', 'closePosition', '.post(', '.delete(']) {
      assert.ok(!src.includes(forbidden), `${f} contains ${forbidden}`);
    }
  }
});
