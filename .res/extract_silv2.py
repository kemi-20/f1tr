import re, html, sys
sys.stdout.reconfigure(encoding='utf-8')
h = open(r'C:/Users/Y/AppData/Local/Temp/rf_silv.html', encoding='utf-8', errors='ignore').read()
text = re.sub(r'<script.*?</script>', ' ', h, flags=re.S)
text = re.sub(r'<style.*?</style>', ' ', text, flags=re.S)
text = re.sub(r'<[^>]+>', ' ', text)
text = re.sub(r'\s+', ' ', text)
text = html.unescape(text)
# Find the main transcript body: between 'team radio transcript' and 'Tags'
m = re.search(r'British GP team radio transcript(.*?)Tags', text, re.S)
if m:
    body = m.group(1)
    # find all lines mentioning Leclerc with power/engine/no
    # Split into sentences and print Leclerc lines + neighbors
    # Just print chunks containing key phrases
    for kw in ['No power','no power','engine','Engine','do something','Vamos','Xavi','Marcos']:
        idxs=[mm.start() for mm in re.finditer(re.escape(kw), body)]
        for i in idxs[:4]:
            seg = body[max(0,i-90):i+170]
            print('['+kw+']', seg)
            print('---')
