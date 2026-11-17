import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { handleBuildReport, type BuildReport } from "@/lib/handlers";
import { report } from "@/lib/report";

// The "App request build" workflow in each app repo reports here when it has built (or failed to build) a change.
export const maxDuration = 60;

function signed(raw: string, sig: string | null): boolean {
  const secret = process.env.BUILD_CALLBACK_SECRET?.trim();
  if (!secret) throw new Error("BUILD_CALLBACK_SECRET is not set");
  if (!sig) return false;
  const want = Buffer.from("sha256=" + createHmac("sha256", secret).update(raw).digest("hex"));
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got);
}

export async function POST(req: Request) {
  const raw = await req.text();
  if (!signed(raw, req.headers.get("x-signature"))) return new NextResponse("bad signature", { status: 401 });
  let r: BuildReport;
  try {
    r = JSON.parse(raw);
  } catch {
    return new NextResponse("not JSON", { status: 400 });
  }
  try {
    await handleBuildReport(r);
    return NextResponse.json({ ok: true });
  } catch (err) {
    report(err, "build.callback", { repo: r.repo, issue: r.issue });
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }
}
