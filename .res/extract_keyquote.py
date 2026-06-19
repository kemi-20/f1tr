import re, html as H
h = open(r'C:/Users/Y/AppData/Local/Temp/spa2019.html', encoding='utf-8', errors='ignore').read()
m = re.search(r'# The key quote(.*?)# What', h, re.S)
if m:
    block = m.group(1)
    block = block.replace('\\n', ' ').replace('\\"', '"').replace('\\\\', '\\')
    # replace the unicode replacement char
    block = block.replace('�', "'")
    print(block[:1800])
else:
    print("NOT FOUND")
