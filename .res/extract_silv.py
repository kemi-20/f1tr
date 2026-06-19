import re, html, sys
sys.stdout.reconfigure(encoding='utf-8')
h = open(r'C:/Users/Y/AppData/Local/Temp/rf_silv.html', encoding='utf-8', errors='ignore').read()
text = re.sub(r'<script.*?</script>', ' ', h, flags=re.S)
text = re.sub(r'<style.*?</style>', ' ', text, flags=re.S)
text = re.sub(r'<[^>]+>', ' ', text)
text = re.sub(r'\s+', ' ', text)
text = html.unescape(text)
for kw in ['power','engine','no grip','do something','Vamos','Xavi',' tyre','fourth','P4','sixth']:
    for m in re.finditer(r'.{60}' + re.escape(kw) + r'.{160}', text, re.I):
        print('['+kw+']', m.group(0)[:230]); print('---')
