// Read-only Polymarket US client. It exposes GET requests only.
// Order placement lives in scripts/execute.ts and nowhere else (CLAUDE.md, Security).
import { PolymarketUS } from 'polymarket-us';

// The SDK's bundled types (0.1.1) lag the live API, so responses are normalized here.
type Json = Record<string, any>;

export interface MarketSummary {
  slug: string;
  question: string;
  title: string;
  description: string;
  category: string;
  marketType: string;
  endDate: string | null;
  active: boolean;
  closed: boolean;
  status: string;
  minTradeQty: number | null;
  tickSize: number | null;
  feeCoefficient: number | null;
  bestBid: number | null;
  bestAsk: number | null;
  teams: string[];
}

export interface Quote {
  slug: string;
  state: string;
  bestBid: number | null;
  bestAsk: number | null;
  lastTrade: number | null;
  bidDepth: number;
  askDepth: number;
}

export interface BookLevel {
  price: number;
  qty: number;
}

export interface Book {
  slug: string;
  state: string;
  bids: BookLevel[];
  offers: BookLevel[];
}

export interface Balance {
  currentBalance: number;
  buyingPower: number;
  assetNotional: number;
  openOrders: number;
  unsettledFunds: number;
}

export interface Position {
  slug: string;
  title: string;
  netContracts: number; // positive = YES (long), negative = NO (short)
  cost: number;
  cashValue: number | null;
  realized: number;
  expired: boolean;
}

export interface OpenOrder {
  id: string;
  slug: string;
  intent: string;
  type: string;
  price: number | null;
  quantity: number;
  filled: number;
}

const num = (v: unknown): number | null => {
  if (v === undefined || v === null || v === '') return null;
  const n = typeof v === 'object' ? Number((v as Json).value) : Number(v);
  return Number.isFinite(n) ? n : null;
};

export function toMarketSummary(m: Json): MarketSummary {
  const teams = new Set<string>();
  for (const side of m.marketSides ?? []) if (side?.team?.name) teams.add(side.team.name);
  return {
    slug: m.slug,
    question: m.question ?? '',
    title: m.title ?? '',
    description: m.description ?? '',
    category: m.category ?? '',
    marketType: m.marketType ?? '',
    endDate: m.endDate ?? null,
    active: Boolean(m.active),
    closed: Boolean(m.closed),
    status: m.status ?? '',
    minTradeQty: num(m.minimumTradeQty),
    tickSize: num(m.orderPriceMinTickSize),
    feeCoefficient: num(m.feeCoefficient),
    bestBid: num(m.bestBidQuote),
    bestAsk: num(m.bestAskQuote),
    teams: [...teams],
  };
}

export function toQuote(r: Json): Quote {
  const d = r.marketData ?? r;
  return {
    slug: d.marketSlug,
    state: d.state ?? '',
    bestBid: num(d.bestBid),
    bestAsk: num(d.bestAsk),
    lastTrade: num(d.lastTradePx),
    bidDepth: Number(d.bidDepth ?? 0),
    askDepth: Number(d.askDepth ?? 0),
  };
}

export function toBook(r: Json): Book {
  const d = r.marketData ?? r;
  const levels = (xs: Json[] = []) => xs.map((l) => ({ price: num(l.px) ?? NaN, qty: Number(l.qty) }));
  return { slug: d.marketSlug, state: d.state ?? '', bids: levels(d.bids), offers: levels(d.offers) };
}

export function toBalance(r: Json): Balance {
  const b = Array.isArray(r.balances) ? (r.balances.find((x: Json) => x.currency === 'USD') ?? r.balances[0]) : r;
  return {
    currentBalance: num(b?.currentBalance) ?? 0,
    buyingPower: num(b?.buyingPower) ?? 0,
    assetNotional: num(b?.assetNotional) ?? 0,
    openOrders: num(b?.openOrders) ?? 0,
    unsettledFunds: num(b?.unsettledFunds) ?? 0,
  };
}

export function toPosition(slug: string, p: Json): Position {
  return {
    slug,
    title: p.marketMetadata?.title ?? slug,
    netContracts: num(p.netPositionDecimal ?? p.netPosition) ?? 0,
    cost: num(p.cost) ?? 0,
    cashValue: num(p.cashValue),
    realized: num(p.realized) ?? 0,
    expired: Boolean(p.expired),
  };
}

export function toOpenOrder(o: Json): OpenOrder {
  return {
    id: o.id,
    slug: o.marketSlug,
    intent: o.intent ?? o.side ?? '',
    type: o.type ?? '',
    price: num(o.price),
    quantity: Number(o.quantity ?? 0),
    filled: Number(o.cumQuantity ?? 0),
  };
}

// Mark held contracts at the price they could be sold at now: best bid for YES, 1 - best ask for NO.
export function markPosition(p: Position, q: Quote | null): number | null {
  if (!q) return null;
  if (p.netContracts > 0) return q.bestBid;
  if (p.netContracts < 0) return q.bestAsk === null ? null : 1 - q.bestAsk;
  return null;
}

export interface ReadOnlyPolymarket {
  readonly authenticated: boolean;
  listMarkets(opts?: { active?: boolean; closed?: boolean; categories?: string[]; pageSize?: number; maxPages?: number }): Promise<MarketSummary[]>;
  market(slug: string): Promise<MarketSummary>;
  quote(slug: string): Promise<Quote>;
  book(slug: string): Promise<Book>;
  balance(): Promise<Balance>;
  positions(): Promise<Position[]>;
  openOrders(): Promise<OpenOrder[]>;
  activities(limit?: number): Promise<Json[]>;
}

export function createReadOnlyClient(creds?: { keyId?: string; secretKey?: string }): ReadOnlyPolymarket {
  const keyId = creds?.keyId ?? process.env.POLYMARKET_KEY_ID;
  const secretKey = creds?.secretKey ?? process.env.POLYMARKET_SECRET_KEY;
  const authenticated = Boolean(keyId && secretKey);
  const client = new PolymarketUS(authenticated ? { keyId, secretKey } : {});

  // The only network primitive in this module: a GET, retried on 429 with backoff.
  const get = async (path: string, query?: Json, auth = false): Promise<Json> => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await client.get<Json>(path, { query, authenticated: auth });
      } catch (err: any) {
        if (err?.name !== 'RateLimitError' || attempt >= 3) throw err;
        await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      }
    }
  };
  const requireAuth = () => {
    if (!authenticated) throw new Error('Polymarket US keys are not set in .env; account reads are unavailable.');
  };

  return {
    authenticated,

    async listMarkets({ active = true, closed = false, categories, pageSize = 500, maxPages = 400 } = {}) {
      // ~83k active markets as of 2026-10-21, mostly sports props. Offsets shift while paging, so dedupe by slug.
      const out = new Map<string, MarketSummary>();
      for (let page = 0; page < maxPages; page++) {
        const r = await get('/v1/markets', { limit: pageSize, offset: page * pageSize, active, closed, categories });
        const markets: Json[] = r.markets ?? [];
        for (const m of markets) out.set(m.slug, toMarketSummary(m));
        if (markets.length < pageSize) return [...out.values()];
      }
      throw new Error(`listMarkets: hit maxPages (${maxPages}); results would be incomplete.`);
    },

    async market(slug) {
      const r = await get(`/v1/market/slug/${encodeURIComponent(slug)}`);
      return toMarketSummary(r.market ?? r);
    },

    async quote(slug) {
      return toQuote(await get(`/v1/markets/${encodeURIComponent(slug)}/bbo`));
    },

    async book(slug) {
      return toBook(await get(`/v1/markets/${encodeURIComponent(slug)}/book`));
    },

    async balance() {
      requireAuth();
      return toBalance(await get('/v1/account/balances', undefined, true));
    },

    async positions() {
      requireAuth();
      const out: Position[] = [];
      let cursor: string | undefined;
      do {
        const r = await get('/v1/portfolio/positions', { limit: 100, cursor }, true);
        for (const [slug, p] of Object.entries<Json>(r.positions ?? {})) out.push(toPosition(slug, p));
        cursor = r.eof ? undefined : r.nextCursor || undefined;
      } while (cursor);
      return out;
    },

    async openOrders() {
      requireAuth();
      const r = await get('/v1/orders/open', undefined, true);
      return (r.orders ?? []).map(toOpenOrder);
    },

    async activities(limit = 100) {
      requireAuth();
      const r = await get('/v1/portfolio/activities', { limit }, true);
      return r.activities ?? [];
    },
  };
}
