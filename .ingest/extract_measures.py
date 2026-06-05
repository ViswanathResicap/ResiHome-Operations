import os, re, glob
SM="powerbi-source/ResiHome Summary.SemanticModel/definition/tables"
PROP_KEYS=("formatString","lineageTag","displayFolder","formatStringDefinition",
           "annotation","changedProperty","isHidden","dataType","summarizeBy",
           "sourceColumn","relatedColumnDetails","kpi","detailRows")
out=[]
total=0
for f in sorted(glob.glob(f"{SM}/*.tmdl")):
    tbl=os.path.basename(f)[:-5]
    lines=open(f,encoding="utf-8",errors="replace").read().split("\n")
    i=0; meas=[]
    while i<len(lines):
        m=re.match(r'^(\t+)measure\s+(.*?)\s*=(.*)$', lines[i])
        if not m:
            i+=1; continue
        indent=m.group(1); name=m.group(2).strip().strip("'")
        expr=[m.group(3).strip()]
        j=i+1
        while j<len(lines):
            ln=lines[j]
            if ln.strip()=="" :
                # blank: peek next; if next is a prop/new decl at <=indent, stop
                k=j+1
                while k<len(lines) and lines[k].strip()=="": k+=1
                if k>=len(lines): break
                nxt=lines[k].strip()
                if nxt.startswith(PROP_KEYS) or re.match(r'(measure|column|partition|table|hierarchy)\b',nxt):
                    break
                j+=1; continue
            s=ln.strip()
            if s.startswith(PROP_KEYS) or re.match(r'(measure|column|partition|table|hierarchy)\b',s):
                break
            expr.append(ln.rstrip())
            j+=1
        meas.append((name," ".join(x.strip() for x in expr).strip()))
        i=j
    if meas:
        total+=len(meas)
        out.append(f"\n## {tbl}  ({len(meas)} measures)\n")
        for n,e in meas:
            e=e if len(e)<600 else e[:600]+" …[truncated]"
            out.append(f"- **{n}** = `{e}`")
open(".ingest/measures_catalog.md","w").write("# DAX measures (from mirrored tables)\n"+"\n".join(out)+f"\n\n_Total: {total} measures across mirrored tables._\n")
print(f"extracted {total} measures -> .ingest/measures_catalog.md")
