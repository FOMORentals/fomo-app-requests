import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { report } from "@/lib/report";
import { runListingsTick } from "@/lib/listings/tick";
import { runTick } from "@/lib/tick";

// Vercel cron, every 15 min at :07 (vercel.json).
export const maxDuration = 60;

function authorised(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) throw new Error("CRON_SECRET is not set");
  const got = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

export async function GET(req: Request) {
  if (!authorised(req)) return new NextResponse("unauthorised", { status: 401 });
  const started = Date.now();
  try {
    const result = await runTick(started);
    // Website listings (/list-kit): reminders and "now live". Its own failure doesn't hide the requests' result.
    let listings;
    try {
      listings = await runListingsTick(started);
    } catch (err) {
      report(err, "tick.listings");
      listings = { reminded: 0, live: 0, missing: 0, failures: 1 };
    }
    console.log("TICK", JSON.stringify({ ...result, listings, ms: Date.now() - started }));
    return NextResponse.json({ ...result, listings }, { status: result.failures > 0 || listings.failures > 0 || result.incomplete ? 502 : 200 });
  } catch (err) {
    report(err, "tick");
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }
}
