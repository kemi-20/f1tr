import re, html, sys
sys.stdout.reconfigure(encoding='utf-8')
h = open(r'C:/Users/Y/AppData/Local/Temp/f1monaco.html', encoding='utf-8', errors='ignore').read()
# Get the key quote region between '# The key quote' and next heading
m = re.search(r'# The key quote(.*?)# What', h, re.S)
if m:
    block = m.group(1).replace('\\n',' ').replace('\\"','"').replace('\\\\','\\').replace('’',"'")
    block = re.sub(r'\\u[0-9a-fA-F]{4}', '', block)
    print(block[:2000])
else:
    # fallback: all <p> with quote-like text
    print("NO KEY QUOTE HEADING - dumping all quote paragraphs")
    for p in re.findall(r'<p[^>]*>(.*?)</p>', h, re.S):
        t = html.unescape(re.sub(r'<[^>]+>','',p))
        if '"' in t or 'said' in t.lower():
            print(t[:500]); print('---')
