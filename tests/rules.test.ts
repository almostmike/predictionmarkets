import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadRules, takerFeePerContract, exclusionHits } from '../scripts/lib/rules.ts';

const rules = loadRules();

test('rules.json matches mandate v0.2', () => {
  assert.equal(rules.starting_capital_usd, 100);
  assert.equal(rules.position_cap_pct_nav, 5);
  assert.equal(rules.max_open_positions, 15);
  assert.equal(rules.min_edge_pp, 10);
  assert.deepEqual(rules.order_types_allowed, ['ORDER_TYPE_LIMIT']);
  assert.equal(rules.max_cross_usd, 0.02);
  assert.equal(rules.daily_entry_limit_usd, 25);
  assert.equal(rules.timezone, 'America/Los_Angeles');
  assert.equal(rules.drawdown_halt_nav_usd, 20);
  assert.equal(rules.max_days_to_resolution, 60);
  assert.equal(rules.kill_switch_file, 'STOP');
  assert.ok(!rules.entry_intents.includes('ORDER_INTENT_SELL_LONG'), 'selling YES short is not an entry');
});

test('taker fee matches the published schedule', () => {
  // docs.polymarket.us/fees: 1,000 contracts at $0.50 costs $17.38; at $0.10, $6.26.
  assert.equal(Math.round(1000 * takerFeePerContract(rules, 0.5) * 100) / 100, 17.38);
  assert.equal(Math.round(1000 * takerFeePerContract(rules, 0.1) * 100) / 100, 6.26);
});

test('exclusions catch the mandate list', () => {
  assert.deepEqual(exclusionHits(rules, ['Will SDSU beat Fresno State?']), ['SDSU']);
  assert.ok(exclusionHits(rules, ['San Jose State Spartans vs Hawaii']).length > 0);
  assert.ok(exclusionHits(rules, ['', 'San Diego State Aztecs']).length > 0);
  assert.ok(exclusionHits(rules, ['Will Medtronic stock close above $100?']).length > 0);
  assert.ok(exclusionHits(rules, ['ISRG Q4 earnings beat']).length > 0);
});

test('exclusions do not over-match', () => {
  assert.deepEqual(exclusionHits(rules, ['Michigan State Spartans vs Ohio State']), []);
  assert.deepEqual(exclusionHits(rules, ['Will the Fed cut rates in December?']), []);
  assert.deepEqual(exclusionHits(rules, ['MDTX token launch']), []);
});
