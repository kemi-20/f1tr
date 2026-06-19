import re, os, sys
TMP = r"C:\Users\Y\AppData\Local\Temp"
name = sys.argv[1]
kws = sys.argv[2].split(",")
win = int(sys.argv[3]) if len(sys.argv) > 3 else 160
t = open(os.path.join(TMP, name + ".txt"), encoding="utf-8", errors="ignore").read()
low = t.lower()
seen = set()
for kw in kws:
    start = 0
    while True:
        i = low.find(kw.lower(), start)
        if i == -1: break
        s = max(0, i - win)
        e = min(len(t), i + len(kw) + win)
        snippet = t[s:e]
        key = snippet[:60]
        if key not in seen:
            seen.add(key)
            print(f"--- [{kw} @ {i}] ---")
            print(snippet)
            print()
        start = i + 1
