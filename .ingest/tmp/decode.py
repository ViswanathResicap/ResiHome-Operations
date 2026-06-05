import sys, base64
# usage: decode.py <b64file> <outfile>
with open(sys.argv[1]) as f:
    data = f.read()
out = base64.b64decode(data)
with open(sys.argv[2], "wb") as f:
    f.write(out)
print("wrote", len(out), "bytes to", sys.argv[2])
