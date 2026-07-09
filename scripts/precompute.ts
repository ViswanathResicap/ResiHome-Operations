// Daily precompute: runs the real API route handlers directly against
// Snowflake (no Vercel 60s limit) and writes the default (unfiltered) payloads
// to data/snapshots/*.json. The app serves these instantly; filtered/other-
// month requests still query live. Run by .github/workflows/refresh.yml daily,
// and locally with:  npx tsx scripts/precompute.ts
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";

// Load .env.local for local runs (the GitHub Action injects real env vars, so
// there's no .env.local there and this is a harmless no-op).
if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const now = new Date();
const month = `${MON[now.getMonth()]} ${now.getFullYear()}`;

// Route handlers are just async (Request) => Response functions — call them directly.
async function main() {
  const { GET: summaryGET } = await import("@/app/api/summary-v2/route");
  const { GET: filtersGET } = await import("@/app/api/filters/route");
  // Operational tabs that use the client-fetched TabPage payload shape.
  // (Off-Market / On Market render server-side, so they're not snapshotted here.)
  const tabs: [string, string][] = [
    ["futuremovein", "futuremovein"], ["collections", "collections"],
    ["renewals", "renewals"], ["turnkey", "turnkey"], ["maintenance", "maintenance"],
  ];

  mkdirSync("data/snapshots", { recursive: true });
  const write = (name: string, data: unknown) => {
    writeFileSync(`data/snapshots/${name}.json`, JSON.stringify(data));
    console.log(`  ✓ ${name}.json`);
  };

  console.log(`Precomputing snapshots for ${month} …`);

  // Summary (default view = current month, no filters). fresh=1 forces a live
  // Snowflake compute instead of reading the previous snapshot.
  const sRes = await summaryGET(new Request(`http://local/api/summary-v2?month=${encodeURIComponent(month)}&fresh=1`));
  const sJson = await sRes.json();
  if (sJson?.error) throw new Error(`summary-v2 failed: ${sJson.error} ${sJson.detail ?? ""}`);
  write("summary", sJson);

  // Filters (org/region/subdivision/PM lists + map points)
  try { write("filters", await (await filtersGET()).json()); } catch (e) { console.log("  ! filters skipped:", (e as Error).message); }

  // Operational tabs (default, no org/region filter)
  for (const [name, route] of tabs) {
    try {
      const { GET } = await import(`@/app/api/${route}/route`);
      const res = await GET(new Request(`http://local/api/${route}?fresh=1`));
      write(name, await res.json());
    } catch (e) { console.log(`  ! ${name} skipped:`, (e as Error).message); }
  }

  console.log("Done.");
  process.exit(0);
}

main().catch((e) => { console.error("PRECOMPUTE FAILED:", e); process.exit(1); });
