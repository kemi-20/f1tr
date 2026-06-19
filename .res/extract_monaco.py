import re, html, sys
sys.stdout.reconfigure(encoding='utf-8')
h = open(r'C:/Users/Y/AppData/Local/Temp/rf_monaco.html', encoding='utf-8', errors='ignore').read()
text = re.sub(r'<script.*?</script>', ' ', h, flags=re.S)
text = re.sub(r'<style.*?</style>', ' ', text, flags=re.S)
text = re.sub(r'<[^>]+>', ' ', text)
text = re.sub(r'\s+', ' ', text)
text = html.unescape(text)
for kw in ['Bozzi', 'dream', 'Vamos', 'child', 'since I was', 'childhood', 'no words', 'thank you']:
    for m in re.finditer(r'.{80}' + re.escape(kw) + r'.{220}', text, re.I):
        print('[' + kw + ']', m.group(0))
        print('---')
