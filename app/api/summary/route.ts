import { getSummary } from "@/lib/summary";

// Returns the live summary from the Next.js Data Cache (kept warm by the cron).
// Reads in ms when warm; the page already rendered the committed snapshot, so a
// cold compute here is never user-blocking.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  const data = await getSummary();
  return Response.json(data, { headers: { "cache-control": "no-store" } });
}
