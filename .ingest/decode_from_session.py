import json, base64, sys, glob, os
# Args: <title.tmdl> <dest_path>
title, dest = sys.argv[1], sys.argv[2]
SESS = sorted(glob.glob("/root/.claude/projects/-home-user-ResiHome-Operations/*.jsonl"),
              key=os.path.getmtime, reverse=True)
def find_payload(obj):
    """Recursively search for a string that is the download payload JSON for `title`."""
    if isinstance(obj, str):
        if '"content"' in obj and title in obj and 'mimeType' in obj:
            try:
                inner = json.loads(obj)
                if isinstance(inner, dict) and inner.get("title") == title and "content" in inner:
                    return inner["content"]
            except Exception:
                pass
        return None
    if isinstance(obj, dict):
        for v in obj.values():
            r = find_payload(v)
            if r: return r
    if isinstance(obj, list):
        for v in obj:
            r = find_payload(v)
            if r: return r
    return None
b64 = None
for sess in SESS:
    with open(sess, encoding="utf-8", errors="replace") as fh:
        for line in fh:
            try: rec = json.loads(line)
            except Exception: continue
            r = find_payload(rec)
            if r: b64 = r  # keep last (most recent) occurrence
    if b64: 
        break
if not b64:
    print(f"NOT FOUND: {title}"); sys.exit(2)
data = base64.b64decode(b64)
os.makedirs(os.path.dirname(dest), exist_ok=True)
open(dest, "wb").write(data)
print(f"WROTE {dest} ({len(data)} bytes)")
