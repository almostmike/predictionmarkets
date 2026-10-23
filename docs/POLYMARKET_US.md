# Polymarket US API notes

Checked against docs.polymarket.us and live public endpoints on 2026-10-21.

## Access
- Public market data: `https://gateway.polymarket.us`, no key.
- Account and trading: `https://api.polymarket.us`, Ed25519-signed headers (`X-PM-Access-Key`, `X-PM-Timestamp`, `X-PM-Signature`); timestamps must be within 30 s of server time.
- Keys: create at polymarket.us/developer after identity verification in the app. The secret is shown once. The docs describe no read-only key scope, so the key can trade; only `scripts/execute.ts` may use it to place orders.
- SDK: `polymarket-us` 0.1.1 (official, pinned). Its bundled types lag the live API, so `scripts/lib/polymarket.ts` normalizes raw responses.

## Market facts that matter for the rules
- About 83,000 active markets; most are sports (props, futures). In a 50,000-market sample on 2026-10-21, 34,000 resolved within 60 days and 96% of those were sports.
- Each market reports `endDate` (used for the 60-day horizon), `category`, `minimumTradeQty` (usually 1 contract, sometimes 0.01), `orderPriceMinTickSize` (0.01 or 0.001), and `feeCoefficient` (0.0695).
- Prices always refer to YES. Buying NO is intent `ORDER_INTENT_BUY_SHORT`; positions report negative `netPositionDecimal` for NO.
- **Order prices are YES prices, even for NO orders.** Verified with the exchange's order preview on 2026-10-22: a `BUY_SHORT` at `0.6225` comes back as `side: SELL` at 0.6225, `outcomeSide: NO`, `action: BUY`. That is, buy NO at 0.3775. The executor converts a NO price `x` to `1 - x` before sending.
- **NO positions are short YES.** Opening NO sells YES: the sale proceeds land in cash (`currentBalance`), and $1.00 per contract is locked as margin (buying power falls by `1 − sale price`). So NAV = cash + value of contracts − $1 per NO contract (`scripts/lib/account.ts`).
- Fees (from 2026-10-19): taker pays `0.0695 × contracts × p × (1 − p)`; makers pay nothing at our volume. `participateDontInitiate: true` makes an order maker-only (rejected if it would match immediately).
- Order types: limit or market; time in force GTC, GTD, IOC, FOK.
- Rate limit: 25 requests/s per IP for the retail API. A `Global Rate Limit Exceeded` reject on a new order is a 5-second latency stopgap, not a real rate limit.

## Endpoints used (read-only)
| Purpose | Endpoint |
|---|---|
| List markets | `GET /v1/markets` (gateway; `limit`, `offset`, `active`, `closed`, `categories`) |
| One market | `GET /v1/market/slug/{slug}` (gateway) |
| Best bid/ask | `GET /v1/markets/{slug}/bbo` (gateway) |
| Order book | `GET /v1/markets/{slug}/book` (gateway) |
| Balances | `GET /v1/account/balances` (api, signed) |
| Positions | `GET /v1/portfolio/positions` (api, signed, cursor-paged) |
| Open orders | `GET /v1/orders/open` (api, signed) |
| Activity | `GET /v1/portfolio/activities` (api, signed) |

## Order endpoints (only `scripts/execute.ts`)
| Purpose | Endpoint |
|---|---|
| Preview (validates; places nothing) | `POST /v1/order/preview` with `{ request: <order> }` |
| Place | `POST /v1/orders` |

Orders are always limit orders, good till the end of the Pacific day (`TIME_IN_FORCE_GOOD_TILL_DATE`), with `manualOrderIndicator: AUTOMATIC`.
