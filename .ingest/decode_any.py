import json, base64, sys, glob, os
title, dest = sys.argv[1], sys.argv[2]
cands = sorted(glob.glob("/root/.claude/projects/-home-user-ResiHome-Operations/*.jsonl"),
               key=os.path.getmtime, reverse=True)
toolres = sorted(glob.glob("/root/.claude/projects/-home-user-ResiHome-Operations/*/tool-results/*download_file_content*.txt"),
                 key=os.path.getmtime, reverse=True)
def payload_from_str(s):
    if '"content"' in s and title in s and 'mimeType' in s:
        try:
            inner=json.loads(s)
            if isinstance(inner,dict) and inner.get("title")==title and "content" in inner:
                return inner["content"]
        except Exception: pass
    return None
def walk(o):
    if isinstance(o,str): return payload_from_str(o)
    if isinstance(o,dict):
        for v in o.values():
            r=walk(v)
            if r: return r
    if isinstance(o,list):
        for v in o:
            r=walk(v)
            if r: return r
    return None
b64=None
# 1) tool-results saved payloads (large files) - try direct json parse
for t in toolres:
    try: inner=json.load(open(t,encoding="utf-8",errors="replace"))
    except Exception: continue
    if isinstance(inner,dict) and inner.get("title")==title and "content" in inner:
        b64=inner["content"]; break
# 2) session jsonl (inline files)
if not b64:
    for sess in cands:
        for line in open(sess,encoding="utf-8",errors="replace"):
            try: rec=json.loads(line)
            except Exception: continue
            r=walk(rec)
            if r: b64=r
        if b64: break
if not b64:
    print(f"NOT FOUND: {title}"); sys.exit(2)
data=base64.b64decode(b64)
os.makedirs(os.path.dirname(dest),exist_ok=True)
open(dest,"wb").write(data)
print(f"WROTE {os.path.basename(dest)} ({len(data)} bytes)")
