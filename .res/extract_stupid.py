import re, html, sys
sys.stdout.reconfigure(encoding='utf-8')
h = open(r'C:/Users/Y/AppData/Local/Temp/gp_stupid.html', encoding='utf-8', errors='ignore').read()
text = re.sub(r'<script.*?</script>', ' ', h, flags=re.S)
text = re.sub(r'<style.*?</style>', ' ', text, flags=re.S)
text = re.sub(r'<[^>]+>', ' ', text)
text = re.sub(r'\s+', ' ', text)
text = html.unescape(text)
# Print the main article region
m = re.search(r'Leclerc: I am stupid.{0,2500}', text, re.S)
if m:
    print(m.group(0)[:2500])
