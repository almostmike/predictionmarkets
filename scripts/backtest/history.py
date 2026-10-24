# Q's forecast history for each covered market, as of its resolution time (one $0.005-0.01 call each).
import json,sys,subprocess,os
from concurrent.futures import ThreadPoolExecutor
S=sys.argv[1]
hits=[json.loads(l) for l in open(f'{S}/hits.jsonl')]
env=dict(os.environ,QUOTIENT_DISABLE_UPDATE_CHECK='1')
def one(x):
    path=f"{S}/history/{x['id']}.json"
    if os.path.exists(path): return 'cached'
    asof=x['end'].replace(' ','T').replace('+00','Z') if '+00' in x['end'] else x['end']
    r=subprocess.run(['node',''+os.path.join(os.path.dirname(os.path.abspath(__file__)),'..','..','node_modules','.bin','quotient')+'','forecast',f"polymarket:{x['id']}",'--as-of',asof,'--history','10','--json','--quiet'],capture_output=True,text=True,env=env)
    if r.returncode!=0: return 'err '+r.stderr.strip()[-120:]
    open(path,'w').write(r.stdout); return 'ok'
with ThreadPoolExecutor(4) as ex:
    res=list(ex.map(one,hits))
from collections import Counter
print(Counter(r if not r.startswith('err') else 'err' for r in res)); [print(r) for r in res if r.startswith('err')][:5]
