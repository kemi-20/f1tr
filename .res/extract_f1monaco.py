import re, html, sys
sys.stdout.reconfigure(encoding='utf-8')
h = open(r'C:/Users/Y/AppData/Local/Temp/f1monaco.html', encoding='utf-8', errors='ignore').read()
# RSC payload: quotes escaped as \"
# Find radio-like quoted segments
# First try the rendered HTML <p> blocks
ps = re.findall(r'<p[^>]*>(.*?)</p>', h, re.S)
print("=== <p> blocks ===")
for p in ps:
    t = re.sub(r'<[^>]+>', '', p)
    t = html.unescape(t).replace('\\u2019',"'")
    if any(k in t.lower() for k in ['dream','vamos','child','since i','bozzi','no words','finally','did it','dad','father','thank']):
        print(t[:400])
        print('---')
