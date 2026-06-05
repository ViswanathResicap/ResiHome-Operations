import json, base64, os, re

JSONL = "/root/.claude/projects/-home-user-ResiHome-Operations/1e795b25-db7d-465f-9193-89a7c90f4dab.jsonl"
TSV = "/home/user/ResiHome-Operations/.ingest/summary_visual_json_ids.tsv"
DEST = "/home/user/ResiHome-Operations/powerbi-source/ResiHome Summary.Report/definition/pages/ReportSectioneec532c7225390830bcc/visuals"

id_by_guid = {}
with open(TSV) as f:
    for line in f:
        parts = line.rstrip("\n").split("\t")
        if len(parts) == 2 and parts[1]:
            id_by_guid[parts[0]] = parts[1]

wanted = set(id_by_guid.values())
found = {}  # id -> list of base64

def record(i, c):
    if i in wanted and isinstance(c, str):
        found.setdefault(i, [])
        if c not in found[i]:
            found[i].append(c)

# The tool result objects look like {"content":"<b64>","id":"<fileId>","mimeType":...,"title":"visual.json"}
# After fully un-escaping the jsonl line, this exact substring appears. Use a tolerant regex
# that captures the base64 (chars in base64 alphabet) immediately preceding the id.
PAT = re.compile(r'"content":"([A-Za-z0-9+/=]+)","id":"([A-Za-z0-9_\-]+)"')

raw = open(JSONL, errors="ignore").read()

# Repeatedly unescape: the content may be nested several escape levels deep.
texts = [raw]
seen = set()
cur = raw
for _ in range(6):
    # decode one level of backslash-escaping
    nxt = cur.replace('\\"', '"').replace('\\\\', '\\').replace('\\n', '\n')
    if nxt == cur:
        break
    texts.append(nxt)
    cur = nxt

for t in texts:
    for m in PAT.finditer(t):
        record(m.group(2), m.group(1))

written, bad, missing = [], [], []
for guid, fid in id_by_guid.items():
    ok = False
    for b64 in found.get(fid, []):
        try:
            data = base64.b64decode(b64)
            json.loads(data.decode("utf-8"))
        except Exception:
            continue
        outdir = os.path.join(DEST, guid)
        os.makedirs(outdir, exist_ok=True)
        with open(os.path.join(outdir, "visual.json"), "wb") as o:
            o.write(data)
        written.append(guid); ok = True
        break
    if not ok:
        (bad if found.get(fid) else missing).append(guid)

print("WRITTEN", len(written))
print("BAD", bad)
print("MISSING", missing)
