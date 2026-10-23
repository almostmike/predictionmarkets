import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flagsFor, orientationFor, price, sportsEventSlugs, overlap, tokens } from '../scripts/lib/match.ts';
import { incoherentEvents, toQForecast, type QForecast } from '../scripts/lib/quotient.ts';
import { toMarketSummary } from '../scripts/lib/polymarket.ts';
import { loadRules } from '../scripts/lib/rules.ts';

const rules = loadRules();

// Synthetic fixtures shaped like the live responses (no real Q data is committed; rule 15).
const qRow = (over: Record<string, any> = {}) => ({
  venue: 'polymarket', nativeMarketId: '1', nativeEventId: 'e1', marketKey: 'polymarket:1', slug: 'nfl-pit-no-2026-10-25',
  q_coverage: 'experimental', question: 'Steelers vs. Saints', end_date: '2026-10-26T03:59:00Z', market_odds: 0.37,
  sports: { league: 'nfl', game_key: 'nfl|no|pit|20261025T1330', kickoff_at: '2026-10-25T13:30:00.000Z', yes_side: { code: 'no', name: 'Saints', canonical_name: 'Saints' } },
  forecast_status: { state: 'sideways' },
  forecast: { id: 'f-1', probability: 0.23, created_at: '2026-10-22T10:00:00Z', market_odds_at_forecast: 0.36, conviction_tier: 2, question_type: 'head_to_head', resolution_pathway: { deadline: '2026-10-26T03:59:00Z', source: 'nfl', criteria: 'tie resolves 50-50' } },
  ...over,
});

const usGame = toMarketSummary({
  slug: 'aec-nfl-pit-no-2026-10-25', question: 'Who will win…', marketType: 'moneyline', sportsMarketType: 'football_team_full_game_winner',
  endDate: '2026-11-08T18:30:00Z', gameStartTime: '2026-10-25T13:30:00Z',
  marketSides: [
    { description: 'Saints', long: false, team: { name: 'New Orleans Saints', safeName: 'NO Saints', alias: 'Saints', abbreviation: 'no' } },
    { description: 'Steelers', long: true, team: { name: 'Pittsburgh Steelers', safeName: 'PIT Steelers', alias: 'Steelers', abbreviation: 'pit' } },
  ],
});

test('parses a Q row into a whitelisted forecast', () => {
  const q = toQForecast(qRow())!;
  assert.equal(q.forecastId, 'f-1');
  assert.equal(q.prob, 0.23);
  assert.equal(q.sports?.yesSide, 'Saints');
  assert.equal(q.marketOddsAtForecast, 0.36);
  assert.ok(!('thesis' in q), 'full thesis must not be carried');
  assert.equal(toQForecast({ question: 'no forecast' }), null);
});

test('sides are ordered YES first and orientation follows Q\'s yes_side', () => {
  assert.equal(usGame.sides[0].label, 'Steelers');
  assert.equal(orientationFor(usGame, 'Saints'), 'flipped');
  assert.equal(orientationFor(usGame, 'Pittsburgh Steelers'), 'same');
  assert.equal(orientationFor(usGame, 'pit'), 'same');
  assert.equal(orientationFor(usGame, 'Ravens'), null);
});

test('builds US event slugs from a Polymarket slug or a game key', () => {
  const q = toQForecast(qRow())!;
  assert.deepEqual(sportsEventSlugs(q).sort(), ['nfl-no-pit-2026-10-25', 'nfl-pit-no-2026-10-25']);
  const k = toQForecast(qRow({ venue: 'kalshi', slug: 'KXNFLGAME-26OCT25NOPIT', marketKey: 'kalshi:x' }))!;
  assert.ok(sportsEventSlugs(k).includes('nfl-pit-no-2026-10-25'));
});

test('edge math: flipped orientation, taker fee on both sides', () => {
  // Q: Saints 23% -> Steelers (US YES) 77%. Ask 0.625: 0.77 - 0.625 - 0.0695*0.625*0.375 = 0.1287
  const p = price(rules, 0.23, 'flipped', 0.6225, 0.625);
  assert.equal(p.usProbYes, 0.77);
  assert.equal(p.yesEdgePp, 12.9);
  assert.equal(p.bestSide, 'YES');
  // NO costs 1 - bid = 0.3775: 0.23 - 0.3775 - fee < 0
  assert.ok(p.noEdgePp! < 0);
  const empty = price(rules, 0.5, 'same', null, null);
  assert.equal(empty.bestSide, null);
});

test('flags: stale, started, horizon, exclusions, adverse move', () => {
  const q = toQForecast(qRow())!;
  const before = flagsFor(rules, q, usGame, false, new Date('2026-10-23T12:00:00Z'));
  assert.deepEqual([before.stale, before.started, before.beyondHorizon, before.excluded.length, before.experimental], [false, false, false, 0, true]);
  const after = flagsFor(rules, q, usGame, false, new Date('2026-10-25T14:00:00Z'));
  assert.equal(after.started, true);
  assert.equal(after.stale, true);
  const far = flagsFor(rules, q, { ...usGame, endDate: '2027-03-01T00:00:00Z' }, false, new Date('2026-10-23T12:00:00Z'));
  assert.equal(far.beyondHorizon, true);
  const sdsu = flagsFor(rules, toQForecast(qRow({ question: 'SDSU vs. Fresno State' }))!, usGame, false, new Date('2026-10-23T12:00:00Z'));
  assert.deepEqual(sdsu.excluded, ['SDSU']);
  const warn = flagsFor(rules, toQForecast(qRow({ forecast_status: { state: 'warning' } }))!, usGame, false, new Date('2026-10-23T12:00:00Z'));
  assert.equal(warn.adverseMove, true);
});

test('contest coherence: many "will X win" at 85% is flagged', () => {
  const contest = (i: number, p: number): QForecast =>
    toQForecast(qRow({ marketKey: `polymarket:g${i}`, nativeMarketId: `g${i}`, sports: { league: 'dpwt', game_key: 'dpwt|genesis|20261022', kickoff_at: '', yes_side: { code: `player-${i}`, name: 'Yes' } }, forecast: { ...qRow().forecast, id: `g${i}`, probability: p, question_type: null } }))!;
  const bad = [0.9, 0.88, 0.85, 0.02].map((p, i) => contest(i, p));
  assert.equal(incoherentEvents(bad).size, 1);
  const ok = [0.4, 0.3, 0.2, 0.05].map((p, i) => contest(i, p));
  assert.equal(incoherentEvents(ok).size, 0);
  // One NFL game listed on three venues is still a two-sided game, not a contest.
  const game = ['polymarket', 'kalshi', 'hl_outcomes'].map((v) => toQForecast(qRow({ marketKey: `${v}:x`, venue: v, forecast: { ...qRow().forecast, probability: 0.6 } }))!);
  assert.equal(incoherentEvents(game).size, 0);
});

test('text overlap ignores stopwords', () => {
  assert.equal(overlap(tokens('Will the Republican Party win the TX-23 House seat?'), tokens('TX-23 House Election Winner republican')), 4 / 6); // republican, tx, 23, house
});
