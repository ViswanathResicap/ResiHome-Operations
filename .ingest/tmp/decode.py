import sys, base64, json
# usage: decode.py <b64file> <outfile>
# Decodes base64, then auto-repairs the known corruption class (dropped trailing
# '}' in repetitive Literal/expr blocks) by inserting '}' at parser-error positions.
with open(sys.argv[1]) as f:
    data = f.read()
out = base64.b64decode(data)
s = out.decode("utf-8")
fixes = 0
for _ in range(200):
    try:
        json.loads(s); break
    except json.JSONDecodeError as e:
        msg = e.msg
        if "Expecting ',' delimiter" in msg or "Expecting property name" in msg or "Expecting ':' delimiter" in msg:
            s = s[:e.pos] + "}" + s[e.pos:]
            fixes += 1
        else:
            print("UNREPAIRABLE:", msg, "at", e.pos, repr(s[e.pos-60:e.pos+5]))
            break
try:
    json.loads(s)
    with open(sys.argv[2], "w", encoding="utf-8", newline="") as f:
        f.write(s)
    print("wrote", len(s), "bytes to", sys.argv[2], "(autofixes:", fixes, ")")
except json.JSONDecodeError as e:
    print("STILL INVALID at", e.pos, repr(s[e.pos-60:e.pos+5]))
