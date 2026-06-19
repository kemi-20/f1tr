import re, html, os, sys
TMP = r"C:\Users\Y\AppData\Local\Temp"
def strip(name):
    p = os.path.join(TMP, name)
    t = open(p + ".html", encoding="utf-8", errors="ignore").read()
    t = re.sub(r"(?s)<script.*?</script>", " ", t)
    t = re.sub(r"(?s)<style.*?</style>", " ", t)
    t = re.sub(r"<[^>]+>", " ", t)
    t = html.unescape(t)
    t = re.sub(r"\s+", " ", t)
    open(p + ".txt", "w", encoding="utf-8").write(t)
    return t
for n in sys.argv[1:]:
    try:
        t = strip(n)
        print(n, len(t))
    except Exception as e:
        print(n, "ERR", e)
