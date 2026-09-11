import sys, json, pdfplumber
out={}
for p in sys.argv[1:]:
    with pdfplumber.open(p) as pdf:
        t="\n".join((pg.extract_text() or "") for pg in pdf.pages)
    out[p.split("/")[-1]]=t
print(json.dumps(out,ensure_ascii=False))
