// Left rail mirroring the Summary page slicers (Org/Venture/Portfolio,
// Pod/Region, PM/APM, Subdivision, Address search, Delinquent status,
// Property status, Month). Static for the first build; wired to filter
// state in a later pass.
const SLICERS: { title: string; placeholder: string }[] = [
  { title: "Organization / Venture / Portfolio", placeholder: "All" },
  { title: "Property Status", placeholder: "All (excl. Dispositions)" },
  { title: "Pod / Region", placeholder: "All" },
  { title: "PM / APM Assigned", placeholder: "All" },
  { title: "Subdivision", placeholder: "All" },
  { title: "Address Search", placeholder: "Search…" },
  { title: "Tenant Delinquent Status", placeholder: "All" },
  { title: "Month", placeholder: "Last 4 months" },
];

export function SlicerRail() {
  return (
    <aside className="rail">
      <div className="brand">
        ResiHome<small>Operations · Summary</small>
      </div>
      {SLICERS.map((s) => (
        <div className="slicer" key={s.title}>
          <h4>{s.title}</h4>
          <div className="control">
            <span>{s.placeholder}</span>
            <span aria-hidden>▾</span>
          </div>
        </div>
      ))}
    </aside>
  );
}
