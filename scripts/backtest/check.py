# Batch-check which candidates Q forecast: 10 market keys per $0.01 call. Appends hits to hits.jsonl.
import json,sys,subprocess,os
S,group,start,n=sys.argv[1],sys.argv[2],int(sys.argv[3]),int(sys.argv[4])
filt=sys.argv[5] if len(sys.argv)>5 else ''
c=[x for x in json.load(open(f'{S}/candidates.json')) if x['group']==group]
if filt.startswith('games'):  # sports game winners only: "Team vs. Team" questions in a league-a-b-date event
    import re
    c=[x for x in c if re.match(r'^[a-z]+-[a-z0-9]+-[a-z0-9]+-\d{4}-\d{2}-\d{2}$',x['event'] or '') and ' vs' in (x['question'] or '')]
c.sort(key=(lambda x:x['end']) if 'recent' in filt else (lambda x:-x['volume']), reverse='recent' in filt)
batch=c[start:start+n]
done=set()
if os.path.exists(f'{S}/checked.txt'): done=set(open(f'{S}/checked.txt').read().split())
batch=[x for x in batch if x['id'] not in done]
env=dict(os.environ,QUOTIENT_DISABLE_UPDATE_CHECK='1')
hits=0
for i in range(0,len(batch),10):
    chunk=batch[i:i+10]
    r=subprocess.run(['node',''+os.path.join(os.path.dirname(os.path.abspath(__file__)),'..','..','node_modules','.bin','quotient')+'','forecast',*[f"polymarket:{x['id']}" for x in chunk],'--json','--quiet'],capture_output=True,text=True,env=env)
    try: d=json.loads(r.stdout)
    except: print('ERR',r.stderr[-200:],file=sys.stderr); break
    with open(f'{S}/latest_responses.jsonl','a') as raw: raw.write(json.dumps(d)+'\n')  # local cache only; never published
    found={str(x.get('marketKey','')).split(':',1)[-1] for x in d.get('results',[])}
    with open(f'{S}/hits.jsonl','a') as h:
        for x in chunk:
            if x['id'] in found: h.write(json.dumps(x)+'\n'); hits+=1
    with open(f'{S}/checked.txt','a') as f: f.write('\n'.join(x['id'] for x in chunk)+'\n')
print(group,'checked',len(batch),'hits',hits)
