// Daily session step 3: match Q forecasts to Polymarket US contracts.
//
//   node scripts/match.ts [--venues polymarket,kalshi] [--min-spread 5]
//       Pulls Q forecasts (about $0.02 per venue), proposes US matches, prices them against the live
//       US book, and writes the working file .cache/match/YYYY-MM-DD.json (local only, never committed).
//
//   node scripts/match.ts record <q-market-key> <us-market-slug> --orientation same|flipped --rules "<comparison>"
//       After the agent has compared both resolution texts, appends the confirmed match to
//       data/forecasts.jsonl with only the fields mandate rule 15 allows to be published.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { ROOT } from './lib/env.ts';
import { createReadOnlyClient } from './lib/polymarket.ts';
import { eventKey, incoherentEvents, mispriced, preflight, type QForecast } from './lib/quotient.ts';
import { type Candidate, type Orientation, flagsFor, matchByText, matchSports, price } from './lib/match.ts';
import { loadRules } from './lib/rules.ts';
import { ptDate } from './lib/time.ts';

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    venues: { type: 'string', default: 'polymarket,kalshi' },
    'min-spread': { type: 'string', default: '5' },
    orientation: { type: 'string' },
    rules: { type: 'string' },
  },
});

const rules = loadRules();
const pm = createReadOnlyClient({});

// The same US game is often matched from both venues: look each quote up once per run.
const quotes = new Map<string, ReturnType<typeof pm.quote>>();
const quoteOnce = (slug: string) => {
  if (!quotes.has(slug)) quotes.set(slug, pm.quote(slug));
  return quotes.get(slug)!;
};
const date = ptDate();
const cacheDir = `${ROOT}.cache/match`;
const cachePath = `${cacheDir}/${date}.json`;

if (positionals[0] === 'record') {
  const [, marketKey, usSlug] = positionals;
  const orientation = values.orientation as Orientation | undefined;
  if (!marketKey || !usSlug || (orientation !== 'same' && orientation !== 'flipped') || !values.rules?.trim()) {
    console.error('usage: match.ts record <q-market-key> <us-market-slug> --orientation same|flipped --rules "<comparison>"');
    process.exit(1);
  }
  const work = JSON.parse(readFileSync(cachePath, 'utf8'));
  const entry = work.matches.find((m: any) => m.q.marketKey === marketKey);
  const cand = entry?.candidates.find((c: any) => c.usMarket.slug === usSlug);
  if (!cand) {
    console.error(`No candidate ${usSlug} for ${marketKey} in ${cachePath}`);
    process.exit(1);
  }
  const quote = await pm.quote(usSlug);
  const pricing = price(rules, entry.q.prob, orientation, quote.bestBid, quote.bestAsk);
  const q: QForecast = entry.q;
  const record = {
    logged_at: new Date().toISOString(),
    q_forecast_id: q.forecastId,
    q_market_key: q.marketKey,
    q_venue: q.venue,
    q_question: q.question,
    q_prob: q.prob,
    q_created_at: q.createdAt,
    q_market_odds_at_forecast: q.marketOddsAtForecast,
    q_coverage: q.coverage,
    market_id: usSlug,
    question: cand.usMarket.question || cand.usMarket.title,
    resolves_at: cand.usMarket.endDate,
    match: { method: cand.method, confidence: cand.confidence, orientation, yes_side: q.sports?.yesSide ?? null, rules_comparison: values.rules.trim() },
    us_prob_yes: pricing.usProbYes,
    bid: quote.bestBid,
    ask: quote.bestAsk,
    quote_at: new Date().toISOString(),
    best_side: pricing.bestSide,
    edge_after_fees_pp: pricing.bestEdgePp,
  };
  appendFileSync(`${ROOT}data/forecasts.jsonl`, JSON.stringify(record) + '\n');
  console.log(JSON.stringify(record, null, 2));
  process.exit(0);
}

const pre = await preflight();
const venues = values.venues!.split(',').map((v) => v.trim()).filter(Boolean);
const all = new Map<string, QForecast>();
for (const v of venues) for (const f of await mispriced(v, Number(values['min-spread']))) all.set(f.marketKey, f);
const qs = [...all.values()];
const incoherent = incoherentEvents(qs);

// Up to 3 forecasts in flight keeps us well under Polymarket US's 25 requests/s.
async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  }));
  return out;
}

const matches = await pool(qs, 3, async (q) => {
  const candidates: Candidate[] = q.sports ? await matchSports(q, pm) : await matchByText(q, pm);
  const priced = [];
  for (const c of candidates) {
    let quote = null;
    let quoteError: string | null = null;
    try {
      quote = await quoteOnce(c.usMarket.slug);
    } catch (err: any) {
      quoteError = `${err?.name ?? 'Error'}: ${err?.message ?? err}`;
    }
    priced.push({
      ...c,
      quote,
      quote_error: quoteError,
      // text_search orientation is unconfirmed: priced as 'same' for triage only
      pricing: quote ? price(rules, q.prob, c.orientation ?? 'same', quote.bestBid, quote.bestAsk) : null,
      flags: flagsFor(rules, q, c.usMarket, incoherent.has(eventKey(q))),
    });
  }
  return { q, candidates: priced };
});

mkdirSync(cacheDir, { recursive: true });
writeFileSync(cachePath, JSON.stringify({ generated_at: new Date().toISOString(), date, ...pre, venues, min_spread_pp: Number(values['min-spread']), incoherent: Object.fromEntries(incoherent), matches }, null, 2));

const clean = (c: any) => !c.flags.stale && !c.flags.started && !c.flags.beyondHorizon && !c.flags.excluded.length && !c.flags.incoherent;
const pct = (x: number | null | undefined) => (x === null || x === undefined ? 'n/a' : x.toFixed(3));
const high = matches.flatMap((m) => m.candidates.filter((c) => c.confidence === 'high').map((c) => ({ q: m.q, c })));
const review = matches.filter((m) => m.candidates.some((c) => c.confidence === 'review'));
console.log(JSON.stringify({
  date,
  cli: pre.cliVersion,
  contract: pre.contractVersion,
  credits_remaining: pre.creditsRemaining,
  q_forecasts: qs.length,
  incoherent_contests: incoherent.size,
  matched_high: high.length,
  needs_review: review.length,
  unmatched: matches.filter((m) => !m.candidates.length).length,
  work_file: cachePath,
}, null, 2));
for (const { q, c } of high) {
  const p = c.pricing;
  const why = Object.entries(c.flags).filter(([k, v]) => k !== 'experimental' && (Array.isArray(v) ? v.length : v)).map(([k]) => k);
  console.log(`HIGH  ${c.usMarket.slug}  via ${q.venue}  ${c.orientation}  Q ${(q.prob * 100).toFixed(0)}% (${q.coverage})  bid ${pct(c.quote?.bestBid)} ask ${pct(c.quote?.bestAsk)}  best ${p?.bestSide ?? 'n/a'} ${p?.bestEdgePp ?? 'n/a'}pp${clean(c) ? '' : `  [${why.join(', ')}]`}`);
}
for (const m of review) {
  console.log(`REVIEW ${m.q.marketKey} "${m.q.question}" -> ${m.candidates.map((c) => `${c.usMarket.slug} (${c.score})`).join(', ')}`);
}
