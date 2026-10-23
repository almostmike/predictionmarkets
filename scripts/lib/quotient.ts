// Quotient (Q) through its pinned CLI with --json. Read-only, metered calls (see docs/QUOTIENT.md).
// Only whitelisted fields leave this module: mandate rule 15 limits what of Q's output may be published.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ROOT } from './env.ts';

const run = promisify(execFile);
const BIN = `${ROOT}node_modules/.bin/quotient`;
const CONTRACT_URL = 'https://dev.quotient.social/api/v1/openapi.json';

type Json = Record<string, any>;

export class QuotientError extends Error {
  readonly code: 'no_key' | 'insufficient_credits' | 'invalid_key' | 'rate_limited' | 'failed';
  constructor(message: string, code: QuotientError['code']) {
    super(message);
    this.code = code;
  }
}

async function cli(args: string[], json = true): Promise<string> {
  try {
    const { stdout } = await run(process.execPath, [BIN, ...args, ...(json ? ['--json'] : [])], {
      env: { ...process.env, QUOTIENT_DISABLE_UPDATE_CHECK: '1' },
      maxBuffer: 64 * 1024 * 1024,
      timeout: 120_000,
    });
    return stdout;
  } catch (err: any) {
    const text = `${err?.stdout ?? ''}\n${err?.stderr ?? ''}`;
    if (/insufficient_credits/.test(text)) throw new QuotientError('Quotient credits are used up (403 insufficient_credits).', 'insufficient_credits');
    if (/invalid_api_key/.test(text)) throw new QuotientError('Quotient rejected the API key (401 invalid_api_key).', 'invalid_key');
    if (/\b429\b|rate.?limit/i.test(text)) throw new QuotientError('Quotient rate limit hit (429).', 'rate_limited');
    throw new QuotientError(`quotient ${args[0]} failed: ${text.trim().split('\n').slice(-1)[0] ?? 'unknown error'}`, 'failed');
  }
}

export async function quotient(args: string[]): Promise<Json> {
  return JSON.parse(await cli(args));
}

export interface Preflight {
  cliVersion: string;
  contractVersion: string | null;
  creditsRemaining: number | null;
}

// Free checks before any paid call. Refuses keyless x402 mode (mandate, Security).
export async function preflight(): Promise<Preflight> {
  const status = await quotient(['status']);
  if (status.accessMode !== 'api_key') {
    throw new QuotientError(`Quotient is in ${status.accessMode ?? 'unknown'} mode, not api_key. Run \`quotient setup\` with an API key.`, 'no_key');
  }
  const cliVersion = (await cli(['--version'], false)).trim();
  const contractVersion = await fetch(CONTRACT_URL)
    .then((r) => r.json())
    .then((d: Json) => d?.info?.version ?? null)
    .catch(() => null);
  return { cliVersion, contractVersion, creditsRemaining: status.account?.creditsRemaining ?? null };
}

export interface QForecast {
  marketKey: string;
  venue: string;
  nativeMarketId: string;
  nativeEventId: string | null;
  questionType: string | null; // e.g. 'contest_winner'
  slug: string;
  question: string;
  endDate: string | null;
  coverage: string | null; // 'forecasting' or 'experimental'
  forecastId: string;
  prob: number; // YES on the exact contract behind marketKey
  createdAt: string;
  marketOddsAtForecast: number | null;
  venuePrice: number | null; // Q's read of the other venue; never used for edge (rule 6)
  conviction: string | null;
  convictionTier: number | null;
  calibratedYes: number | null;
  qualityStatus: string | null;
  forecastState: string | null; // forecast_status.state
  sports: { league: string; gameKey: string; kickoffAt: string; yesSide: string | null; yesCode: string | null } | null;
  resolution: { deadline: string | null; source: string | null; criteria: string };
  headline: string | null;
  bluf: string | null;
  crux: string | null;
}

// Accepts a market row (mispriced, markets list) or a `forecast` response; both nest the forecast.
export function toQForecast(row: Json): QForecast | null {
  const f = row.forecast;
  if (!f?.id || typeof f.probability !== 'number') return null;
  const m = row.market ?? f.market ?? row;
  const s = row.sports;
  return {
    marketKey: m.marketKey ?? row.marketKey,
    venue: m.venue ?? row.venue,
    nativeMarketId: String(m.nativeMarketId ?? row.nativeMarketId),
    nativeEventId: m.nativeEventId ?? row.nativeEventId ?? null,
    questionType: f.question_type ?? null,
    slug: m.slug ?? row.slug ?? row.market_slug ?? '',
    question: row.question ?? '',
    endDate: row.end_date ?? f.resolution_pathway?.deadline ?? null,
    coverage: m.q_coverage ?? row.q_coverage ?? null,
    forecastId: f.id,
    prob: f.probability,
    createdAt: f.created_at,
    marketOddsAtForecast: f.market_odds_at_forecast ?? null,
    venuePrice: row.market_odds ?? null,
    conviction: f.conviction ?? null,
    convictionTier: f.conviction_tier ?? null,
    calibratedYes: f.conviction_calibration?.calibratedYes ?? null,
    qualityStatus: f.quality?.status ?? null,
    forecastState: row.forecast_status?.state ?? null,
    sports: s ? { league: s.league, gameKey: s.game_key, kickoffAt: s.kickoff_at, yesSide: s.yes_side?.canonical_name ?? s.yes_side?.name ?? null, yesCode: s.yes_side?.code ?? null } : null,
    resolution: {
      deadline: f.resolution_pathway?.deadline ?? null,
      source: f.resolution_pathway?.source ?? null,
      criteria: f.resolution_pathway?.criteria ?? '',
    },
    headline: f.headline ?? null,
    bluf: row.bluf ?? f.bluf ?? null,
    crux: f.crux ?? f.resolution_pathway?.crux ?? null,
  };
}

export function rowsOf(resp: Json): Json[] {
  return Array.isArray(resp) ? resp : (resp.markets ?? resp.signals ?? resp.forecasts ?? []);
}

// Q forecasts on one venue where Q differs from that venue's price ($0.02 per call).
export async function mispriced(venue: string, minSpreadPp = 5): Promise<QForecast[]> {
  const resp = await quotient(['markets', 'mispriced', '--venue', venue, '--min-spread', `${minSpreadPp}pp`]);
  return rowsOf(resp).map(toQForecast).filter((x): x is QForecast => x !== null);
}

// Latest forecasts for up to 10 market keys per call ($0.01 per call).
export async function forecasts(marketKeys: string[]): Promise<QForecast[]> {
  const out: QForecast[] = [];
  for (let i = 0; i < marketKeys.length; i += 10) {
    const resp = await quotient(['forecast', ...marketKeys.slice(i, i + 10)]);
    const rows = Array.isArray(resp) || resp.markets || resp.forecasts ? rowsOf(resp) : [resp];
    out.push(...rows.map(toQForecast).filter((x): x is QForecast => x !== null));
  }
  return out;
}

export const eventKey = (f: QForecast) => f.sports?.gameKey ?? `${f.venue}:${f.nativeEventId ?? f.nativeMarketId}`;

// In a contest (one winner among three or more distinct YES sides, e.g. a golf tournament) Q's YES
// probabilities should sum to about 1. Returns contests whose sum exceeds the limit: a sign the data is
// wrong and none of that contest should be traded. A head-to-head game has at most two sides, so it never
// qualifies, even when several venues list it.
export function incoherentEvents(fs: QForecast[], limit = 1.25): Map<string, number> {
  const sides = new Map<string, Map<string, number>>();
  for (const f of fs) {
    const side = f.sports?.yesCode ?? (f.questionType === 'contest_winner' ? f.marketKey : null);
    if (!side) continue;
    const bySide = sides.get(eventKey(f)) ?? new Map<string, number>();
    bySide.set(side, Math.max(bySide.get(side) ?? 0, f.prob));
    sides.set(eventKey(f), bySide);
  }
  const out = new Map<string, number>();
  for (const [key, bySide] of sides) {
    const sum = [...bySide.values()].reduce((a, b) => a + b, 0);
    if (bySide.size >= 3 && sum > limit) out.set(key, Math.round(sum * 100) / 100);
  }
  return out;
}
