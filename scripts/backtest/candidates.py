# Resolved international Polymarket markets (public data) as backtest candidates.
import json,sys,time,urllib.request,urllib.parse
out=sys.argv[1]
GROUPS={'eligible':['politics','elections','geopolitics','economy','fed-rates','inflation','economic-policy','finance','commodities','stocks'],
        'sports':['nfl','nba','nhl','college-football']}
seen={}; 
def get(url):
    for a in range(5):
        try: return json.load(urllib.request.urlopen(url,timeout=20))
        except Exception as e: time.sleep(2*2**a)
    return []
for group,tags in GROUPS.items():
    for tag in tags:
        for off in range(0,600,100):
            q=urllib.parse.urlencode({'closed':'true','tag_slug':tag,'limit':100,'offset':off,'end_date_min':'2026-02-20T00:00:00Z','end_date_max':'2026-10-21T00:00:00Z','order':'volume','ascending':'false'})
            evs=get('https://gamma-api.polymarket.com/events?'+q)
            if not evs: break
            for e in evs:
                for m in e.get('markets',[]):
                    try: prices=json.loads(m.get('outcomePrices') or '[]'); outs=json.loads(m.get('outcomes') or '[]')
                    except: continue
                    if len(prices)!=2 or m.get('umaResolutionStatus')!='resolved' or not m.get('closed'): continue
                    p=[float(x) for x in prices]
                    if not ((p[0]>0.99 and p[1]<0.01) or (p[0]<0.01 and p[1]>0.99)): continue
                    end=m.get('closedTime') or m.get('endDate')
                    if not end or end<'2026-02-20' or end>'2026-10-21': continue
                    mid=str(m['id'])
                    if mid in seen: continue
                    seen[mid]=dict(id=mid,group=group,tag=tag,question=m.get('question'),outcomes=outs,yes_won=p[0]>0.99,end=end,volume=float(m.get('volumeNum') or m.get('volume') or 0),event=e.get('slug'))
            time.sleep(0.3)
        print(group,tag,len(seen),file=sys.stderr,flush=True)
json.dump(list(seen.values()),open(out,'w'))
