import re
html = open(r'C:/Users/Y/AppData/Local/Temp/spa2019.html', encoding='utf-8', errors='ignore').read()
for kw in ['Hubert','dream','Since I was','stupid','Vamos','Bozzi','maiden','thank','Xavi','P1','emotion','win']:
    idxs = [m.start() for m in re.finditer(re.escape(kw), html)]
    print(kw, len(idxs))
print("=== dream context ===")
for m in re.finditer(r'dream', html):
    s = max(0, m.start()-120); e = m.end()+220
    print(repr(html[s:e]))
print("=== Since I was context ===")
for m in re.finditer(r'Since I was', html):
    s = max(0, m.start()-120); e = m.end()+220
    print(repr(html[s:e]))
print("=== Hubert context ===")
for m in re.finditer(r'Hubert', html):
    s = max(0, m.start()-80); e = m.end()+180
    print(repr(html[s:e]))
