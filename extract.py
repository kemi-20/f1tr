import re,sys,html
sys.stdout.reconfigure(encoding='utf-8')
def extract(fn, label):
    print('==============',label,'==============')
    data=open(fn,encoding='utf-8',errors='ignore').read()
    h1=re.search(r'<h1[^>]*class="entry-title"[^>]*>(.*?)</h1>',data,re.S)
    title=re.sub(r'<[^>]+>','',h1.group(1)) if h1 else '?'
    print('TITLE:',title[:120])
    if not h1: print('BLOCKED'); return
    body_start=h1.end()
    end_m=re.search(r'<h2[^>]*comment', data[body_start:])
    end = body_start+end_m.start() if end_m else body_start+18000
    seg=data[body_start:end]
    for pat,rep in [('<script.*?</script>',' '),('<style.*?</style>',' '),('<aside.*?</aside>',' '),('<img[^>]*/?>','')]:
        seg=re.sub(pat,rep,seg,flags=re.S)
    seg=re.sub(r'<[^>]+>',' ',seg); seg=html.unescape(seg); seg=re.sub(r'\s+',' ',seg)
    parts=re.split(r'(?=Lap: \d)',seg)
    kept=0
    for p in parts:
        if any(k in p for k in ['Gannon','Magnussen','Hulkenberg','Schumacher','Slade','GRO:','MAG:','HUL:','MSC:','Bearman','Haas']):
            print('  ~~',p.strip()[:320]); kept+=1
            if kept>50: break
    print('[kept blocks]',kept)
args=sys.argv[1:]
i=0
while i+1 < len(args):
    extract(args[i],args[i+1]); i+=2
