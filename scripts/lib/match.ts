// Event-level matching of Q forecasts (other venues) to Polymarket US contracts (CLAUDE.md, daily session step 3).
// A match here is a proposal: the agent must still compare both resolution texts before it counts.
import type { QForecast } from './quotient.ts';
import type { EventSummary, MarketSummary, ReadOnlyPolymarket, Side } from './polymarket.ts';
import { type Rules, exclusionHits, takerFeePerContract } from './rules.ts';
import { daysUntil } from './time.ts';

export type Orientation = 'same' | 'flipped';

export interface Candidate {
  method: 'sports_event_slug' | 'text_search';
  confidence: 'high' | 'review';
  usEvent: string;
  usMarket: MarketSummary;
  orientation: Orientation | null; // null until the agent decides (text_search)
  score: number;
}

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim();

export function sideMatchesTeam(side: Side, name: string): boolean {
  const target = norm(name);
  if (!target) return false;
  const t = side.team;
  const names = [side.label, t?.name, t?.safeName, t?.alias, t?.abbreviation].filter(Boolean).map((x) => norm(x!));
  return names.includes(target) || (t !== null && norm(t.name).endsWith(` ${target}`));
}

// Q's YES team against the US contract's YES (long) and NO sides.
export function orientationFor(market: MarketSummary, yesTeam: string): Orientation | null {
  const [yes, no] = market.sides;
  if (!yes?.team || !no?.team) return null;
  const onYes = sideMatchesTeam(yes, yesTeam);
  const onNo = sideMatchesTeam(no, yesTeam);
  if (onYes === onNo) return null; // neither or both: ambiguous
  return onYes ? 'same' : 'flipped';
}

// US event slugs look like `nfl-pit-no-2026-10-25`. International Polymarket game slugs are identical;
// Q's game_key (`nfl|no|pit|20261025T1330`) gives the teams and date in some order.
export function sportsEventSlugs(q: QForecast): string[] {
  const out = new Set<string>();
  if (q.venue === 'polymarket' && /^[a-z0-9]+-[a-z0-9]+-[a-z0-9]+-\d{4}-\d{2}-\d{2}$/.test(q.slug)) out.add(q.slug);
  const parts = q.sports?.gameKey.split('|') ?? [];
  const m = /^(\d{4})(\d{2})(\d{2})/.exec(parts[3] ?? '');
  if (parts.length === 4 && m) {
    const [league, a, b] = parts;
    const date = `${m[1]}-${m[2]}-${m[3]}`;
    out.add(`${league}-${a}-${b}-${date}`);
    out.add(`${league}-${b}-${a}-${date}`);
  }
  return [...out];
}

export function isWinnerMarket(m: MarketSummary): boolean {
  return m.sportsMarketType.endsWith('full_game_winner') || (m.marketType === 'moneyline' && m.sides.every((s) => s.team));
}

export async function matchSports(q: QForecast, pm: ReadOnlyPolymarket): Promise<Candidate[]> {
  if (!q.sports?.yesSide) return [];
  for (const slug of sportsEventSlugs(q)) {
    const event = await pm.event(slug);
    if (!event) continue;
    return event.markets
      .filter(isWinnerMarket)
      .map((usMarket) => ({ usMarket, orientation: orientationFor(usMarket, q.sports!.yesSide!) }))
      .filter((c) => c.orientation !== null)
      .map((c) => ({ method: 'sports_event_slug' as const, confidence: 'high' as const, usEvent: event.slug, score: 1, ...c }));
  }
  return [];
}

const STOP = new Set('will the a an of in on by to be is at for and or vs win who which what end before after than more less'.split(' '));
export const tokens = (s: string) => new Set(norm(s).split(' ').filter((t) => t.length > 1 && !STOP.has(t)));

export function overlap(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let n = 0;
  for (const t of a) if (b.has(t)) n++;
  return n / Math.min(a.size, b.size);
}

// Non-sports: search US events by Q's question, keep close text matches whose dates line up.
export async function matchByText(q: QForecast, pm: ReadOnlyPolymarket, minScore = 0.5, maxDaysApart = 7): Promise<Candidate[]> {
  const qTokens = tokens(q.question);
  if (!qTokens.size) return [];
  const events: EventSummary[] = await pm.search([...qTokens].join(' '), 10);
  const qEnd = q.resolution.deadline ?? q.endDate;
  const out: Candidate[] = [];
  for (const e of events) {
    if (qEnd && e.endDate && Math.abs(daysUntil(e.endDate, new Date(qEnd))) > maxDaysApart) continue;
    for (const usMarket of e.markets) {
      const score = overlap(qTokens, tokens(`${e.title} ${usMarket.question} ${usMarket.title} ${usMarket.slug.replace(/-/g, ' ')}`));
      if (score >= minScore) out.push({ method: 'text_search', confidence: 'review', usEvent: e.slug, usMarket, orientation: null, score: Math.round(score * 100) / 100 });
    }
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 5);
}

export interface Pricing {
  usProbYes: number;
  bid: number | null;
  ask: number | null;
  yesEdgePp: number | null; // buy YES at the ask
  noEdgePp: number | null; // buy NO at 1 - bid
  bestSide: 'YES' | 'NO' | null;
  bestEdgePp: number | null;
}

// Rule 6: edge against the live US book, always assuming the taker fee.
export function price(rules: Rules, qProb: number, orientation: Orientation, bid: number | null, ask: number | null): Pricing {
  const p = orientation === 'same' ? qProb : 1 - qProb;
  const pp = (x: number) => Math.round(x * 1000) / 10;
  const yesEdge = ask === null ? null : pp(p - ask - takerFeePerContract(rules, ask));
  const noPrice = bid === null ? null : 1 - bid;
  const noEdge = noPrice === null ? null : pp(1 - p - noPrice - takerFeePerContract(rules, noPrice));
  const best = yesEdge === null && noEdge === null ? null : (yesEdge ?? -Infinity) >= (noEdge ?? -Infinity) ? 'YES' : 'NO';
  return { usProbYes: p, bid, ask, yesEdgePp: yesEdge, noEdgePp: noEdge, bestSide: best, bestEdgePp: best === 'YES' ? yesEdge : best === 'NO' ? noEdge : null };
}

export interface Flags {
  stale: boolean; // forecast older than 48 hours
  started: boolean; // the game has begun; no in-play entries
  beyondHorizon: boolean; // US contract resolves more than rules.max_days_to_resolution out
  excluded: string[];
  experimental: boolean;
  incoherent: boolean;
  adverseMove: boolean; // forecast_status caution or warning
}

export function flagsFor(rules: Rules, q: QForecast, us: MarketSummary, incoherent: boolean, now = new Date()): Flags {
  const usEnd = us.endDate ?? q.resolution.deadline;
  return {
    stale: daysUntil(q.createdAt, now) < -2,
    started: Boolean(us.gameStartTime && Date.parse(us.gameStartTime) <= now.getTime()),
    beyondHorizon: !usEnd || daysUntil(usEnd, now) > rules.max_days_to_resolution || daysUntil(usEnd, now) < 0,
    excluded: exclusionHits(rules, [q.question, us.question, us.title, us.description, ...us.teams]),
    experimental: q.coverage === 'experimental',
    incoherent,
    adverseMove: q.forecastState === 'caution' || q.forecastState === 'warning',
  };
}
