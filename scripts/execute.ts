// The executor: the only code that sends orders to Polymarket US (CLAUDE.md, Security).
//
//   node scripts/execute.ts <proposals.json>
//
// Every proposal is checked against the hard rules (scripts/lib/guardrails.ts) using a fresh account
// snapshot and live quotes, then previewed by the exchange. With DRY_RUN anything other than "false"
// (the default) nothing is placed and the record says dry_run. Every proposal, including rejections,
// appends one decision record to data/decisions.jsonl.
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { PolymarketUS } from 'polymarket-us';
import { DATA_DIR, ROOT, isDryRun, loadEnv } from './lib/env.ts';
import { createReadOnlyClient } from './lib/polymarket.ts';
import { type Snapshot, snapshot } from './lib/account.ts';
import { type Context, type Proposal, type Violation, buildOrder, checkProposal, edgeAfterFeesPp, entryCost, sideQuote } from './lib/guardrails.ts';
import { loadRules } from './lib/rules.ts';
import { ptDate } from './lib/time.ts';

loadEnv();
const rules = loadRules();
const dryRun = isDryRun();
const decisionsPath = `${DATA_DIR}/decisions.jsonl`;

const input = process.argv[2];
if (!input) {
  console.error('usage: node scripts/execute.ts <proposals.json>');
  process.exit(1);
}
const parsed = JSON.parse(readFileSync(input, 'utf8'));
const proposals: Proposal[] = Array.isArray(parsed) ? parsed : (parsed.proposals ?? []);

// "No trade today" is a decision too (CLAUDE.md, daily session step 4): { "proposals": [], "no_trade_reason": "..." }.
if (!proposals.length) {
  const reason = String(parsed.no_trade_reason ?? '').trim();
  if (!reason) {
    console.error('execute: no proposals and no no_trade_reason; nothing logged.');
    process.exit(1);
  }
  const record = { id: randomUUID(), timestamp: new Date().toISOString(), action: 'none', status: 'no_trade', rationale: reason, dry_run: dryRun };
  appendFileSync(decisionsPath, JSON.stringify(record) + '\n');
  console.log(JSON.stringify(record, null, 2));
  process.exit(0);
}

// New-entry dollars already sent today. In dry run, earlier dry-run entries count too, so a rehearsal
// behaves like a live day; live runs count only orders that actually went out.
function enteredToday(today: string): number {
  if (!existsSync(decisionsPath)) return 0;
  const counted = dryRun ? ['dry_run', 'proposed', 'filled', 'partial'] : ['proposed', 'filled', 'partial'];
  return readFileSync(decisionsPath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .filter((r) => r.action === 'entry' && counted.includes(r.status) && ptDate(new Date(r.timestamp)) === today)
    .reduce((s, r) => s + (r.size_usd ?? 0), 0);
}

const pm = createReadOnlyClient();
if (!pm.authenticated) {
  console.error('execute: Polymarket US keys are not set in .env; nothing can be checked or sent.');
  process.exit(2);
}
const trader = new PolymarketUS({ keyId: process.env.POLYMARKET_KEY_ID, secretKey: process.env.POLYMARKET_SECRET_KEY });

const now = new Date();
const today = ptDate(now);
const stopFile = existsSync(`${ROOT}${rules.kill_switch_file}`);
let snap: Snapshot | null = null;
let snapError: string | null = null;
try {
  snap = await snapshot(pm);
  if (snap.unmarked.length) snapError = `positions without a price: ${snap.unmarked.join(', ')}`;
} catch (err: any) {
  snapError = `${err?.name ?? 'Error'}: ${err?.message ?? err}`;
}
let spentToday = enteredToday(today);

const results = [];
for (const p of proposals) {
  const [market, quote] = await Promise.all([pm.market(p.market_id).catch(() => null), pm.quote(p.market_id).catch(() => null)]);
  const quoteAt = new Date().toISOString();
  let violations: Violation[];
  if (!snap || snapError) {
    // Daily session rule: if the account doesn't reconcile, nothing trades.
    violations = [{ rule: 'reconcile', message: `Account did not reconcile (${snapError ?? 'no snapshot'}).` }];
  } else {
    const ctx: Context = { now: new Date(), stopFile, nav: snap.nav, buyingPower: snap.buyingPower, positions: snap.positions, openOrders: snap.openOrders, enteredTodayUsd: spentToday, market, quote };
    violations = checkProposal(rules, p, ctx);
  }

  const cost = p.action === 'entry' ? entryCost(rules, p) : p.quantity * p.limit_price;
  const sq = sideQuote(quote, p.side);
  const record: Record<string, unknown> = {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    action: p.action,
    market_id: p.market_id,
    question: market?.question || market?.title || null,
    resolves_at: market?.endDate ?? null,
    side: p.side,
    limit_price: p.limit_price,
    quantity: p.quantity,
    q_forecast_id: p.q_forecast_id ?? null,
    q_prob: p.q_prob_us_yes ?? null,
    q_created_at: p.q_created_at ?? null,
    q_market_key: p.q_market_key ?? null,
    q_venue: p.q_venue ?? null,
    q_market_odds_at_forecast: p.q_market_odds_at_forecast ?? null,
    match: p.match ?? null,
    bid: sq.bid,
    ask: sq.ask,
    quote_at: quoteAt,
    agent_prob: p.agent_prob ?? null,
    edge_after_fees: p.action === 'entry' ? edgeAfterFeesPp(rules, p) : null,
    size_usd: Math.round(cost * 100) / 100,
    pct_nav: snap?.nav ? Math.round((cost / snap.nav) * 1000) / 10 : null,
    rationale: p.rationale,
    exit_condition: p.exit_condition ?? null,
    dry_run: dryRun,
  };

  if (violations.length) {
    Object.assign(record, { status: 'rejected', rejected_rules: violations });
  } else {
    const order = buildOrder(p);
    try {
      const preview: any = await trader.orders.preview({ request: order }); // exchange-side validation; places nothing
      record.preview = { intent: preview?.order?.intent ?? null, price: preview?.order?.price?.value ?? null, quantity: preview?.order?.quantity ?? null };
      if (process.argv.includes('--show-preview')) console.error(JSON.stringify({ sent: order, preview }, null, 2)); // local debugging only; never saved
      if (dryRun) {
        record.status = 'dry_run';
      } else {
        const res = await trader.orders.create(order);
        Object.assign(record, { status: 'proposed', order_id: res.id }); // resting until reconcile records fills
      }
      if (p.action === 'entry') {
        spentToday += cost;
        snap!.openOrders.push({ slug: p.market_id, action: 'entry', side: p.side, price: p.limit_price, remaining: p.quantity });
      }
    } catch (err: any) {
      Object.assign(record, { status: 'rejected', rejected_rules: [{ rule: 'exchange', message: `${err?.name ?? 'Error'}: ${String(err?.message ?? err).slice(0, 300)}` }] });
    }
  }
  appendFileSync(decisionsPath, JSON.stringify(record) + '\n');
  results.push(record);
}

console.log(JSON.stringify({
  dry_run: dryRun,
  stop_file: stopFile,
  nav: snap?.nav ?? null,
  entered_today_usd: Math.round(spentToday * 100) / 100,
  results: results.map((r) => ({ market: r.market_id, action: r.action, side: r.side, status: r.status, size_usd: r.size_usd, edge: r.edge_after_fees, rejected: (r.rejected_rules as Violation[] | undefined)?.map((v) => `${v.rule}: ${v.message}`) })),
}, null, 2));
