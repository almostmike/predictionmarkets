# Replay the mandate's and STRATEGY.md's entry rules on Q's historical forecasts (phase 3a).
# One position per market, at the first forecast that qualifies, held to resolution.
# Entry price: the market price stored with Q's forecast (a midpoint) plus a 1-cent half spread, plus the taker fee.
import json, sys, os, random, statistics
from datetime import datetime, timezone

S = sys.argv[1]
THETA, HALF_SPREAD, MANDATE_EDGE, AGENT_EDGE = 0.0695, 0.01, 0.10, 0.04
MIN_H, MAX_D = 12, 60

def ts(s):
    # Timestamps arrive as '...Z', '...+00', or '+00:00', with 0-9 fractional digits; Python 3.9 needs them normalized.
    import re
    s = s.strip().replace(' ', 'T')
    s = re.sub(r'(Z|\+00(:?00)?)$', '', s)
    s = re.sub(r'\.\d+', '', s)
    return datetime.fromisoformat(s).replace(tzinfo=timezone.utc)

hits = {json.loads(l)['id']: json.loads(l) for l in open(f'{S}/hits.jsonl')}
markets = []
for mid, meta in hits.items():
    p = f'{S}/history/{mid}.json'
    if not os.path.exists(p):
        continue
    d = json.load(open(p))
    fs = {}
    for f in [d.get('forecast') or {}] + (d.get('history') or []):
        if f.get('id') and isinstance(f.get('probability'), (int, float)) and isinstance(f.get('market_odds_at_forecast'), (int, float)):
            fs[f['id']] = (ts(f['created_at']), f['probability'], f['market_odds_at_forecast'])
    T = ts(meta['end'])
    usable = sorted(x for x in fs.values() if MIN_H * 3600 <= (T - x[0]).total_seconds() <= MAX_D * 86400)
    markets.append(dict(id=mid, group=meta['group'], tag=meta['tag'], yes_won=meta['yes_won'], forecasts=usable,
                        coverage=((d.get('market') or {}).get('q_coverage'))))

def fee(c): return THETA * c * (1 - c)

def replay(k=None, agent_edge=AGENT_EDGE, mandate=True):
    trades = []
    for m in markets:
        for (t, q, mo) in m['forecasts']:
            side = 'YES' if q > mo else 'NO'
            q_side = q if side == 'YES' else 1 - q
            mo_side = mo if side == 'YES' else 1 - mo
            c = min(0.99, mo_side + HALF_SPREAD)
            if c <= 0.01:
                continue
            cost = c + fee(c)
            if mandate and q_side - cost < MANDATE_EDGE:
                continue
            if k is not None:
                agent_side = mo_side + k * (q_side - mo_side)
                if agent_side - cost < agent_edge:
                    continue
            won = (side == 'YES') == m['yes_won']
            trades.append(dict(group=m['group'], tag=m['tag'], side=side, cost=cost, ret=(1 - cost) / cost if won else -1.0, won=won))
            break
    return trades

def summarize(trades):
    if not trades:
        return dict(n=0)
    rets = [x['ret'] for x in trades]
    random.seed(7)
    boots = sorted(statistics.mean(random.choices(rets, k=len(rets))) for _ in range(2000))
    return dict(n=len(trades), win_rate=round(sum(x['won'] for x in trades) / len(trades), 3),
                mean_return=round(statistics.mean(rets), 3), median_return=round(statistics.median(rets), 3),
                ci90=[round(boots[100], 3), round(boots[1899], 3)],
                avg_cost=round(statistics.mean(x['cost'] for x in trades), 3))

def brier(group=None):
    qs, ms = [], []
    for m in markets:
        if group and m['group'] != group:
            continue
        o = 1.0 if m['yes_won'] else 0.0
        for (t, q, mo) in m['forecasts']:
            qs.append((q - o) ** 2); ms.append((mo - o) ** 2)
    return dict(forecasts=len(qs), q=round(statistics.mean(qs), 4) if qs else None, market=round(statistics.mean(ms), 4) if ms else None)

out = {'markets_with_usable_forecasts': sum(1 for m in markets if m['forecasts']),
       'by_group_markets': {g: sum(1 for m in markets if m['group'] == g and m['forecasts']) for g in ('eligible', 'sports')},
       'brier': {g: brier(g) for g in ('eligible', 'sports')}, 'rules': {}}
variants = {'mandate only (Q edge >= 10)': dict(k=None), 'strategy v1.0 (k=0.5, agent edge >= 4)': dict(k=0.5),
            'k=0.25, agent edge >= 4': dict(k=0.25), 'k=0.75, agent edge >= 4': dict(k=0.75), 'k=1.0, agent edge >= 4': dict(k=1.0)}
for name, kw in variants.items():
    tr = replay(**kw)
    out['rules'][name] = {'all': summarize(tr), 'eligible': summarize([x for x in tr if x['group'] == 'eligible']),
                          'sports': summarize([x for x in tr if x['group'] == 'sports']),
                          'eligible YES': summarize([x for x in tr if x['group'] == 'eligible' and x['side'] == 'YES']),
                          'eligible NO': summarize([x for x in tr if x['group'] == 'eligible' and x['side'] == 'NO']),
                          'politics': summarize([x for x in tr if x['tag'] == 'politics']),
                          'geopolitics': summarize([x for x in tr if x['tag'] == 'geopolitics'])}
json.dump(out, open(f'{S}/replay.json', 'w'), indent=1)
print(json.dumps(out, indent=1))
