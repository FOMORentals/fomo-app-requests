import { NextResponse } from "next/server";
import { cutoutSigned, handleCutoutCall, type CutoutCall } from "@/lib/listings/cutout";
import { report } from "@/lib/report";

// The "Listing photo cut-out" workflow (.github/workflows/listing-cutout.yml) calls here, signed with the same
// secret as build and question reports (BUILD_CALLBACK_SECRET here, APP_REQUESTS_CALLBACK_SECRET in GitHub).
export const maxDuration = 60;

export async function POST(req: Request) {
  const raw = await req.text();
  const secret = process.env.BUILD_CALLBACK_SECRET?.trim();
  if (!secret) return new NextResponse("BUILD_CALLBACK_SECRET is not set", { status: 500 });
  if (!cutoutSigned(raw, req.headers.get("x-signature"), secret)) return new NextResponse("bad signature", { status: 401 });
  let c: CutoutCall;
  try {
    c = JSON.parse(raw);
  } catch {
    return new NextResponse("not JSON", { status: 400 });
  }
  try {
    return await handleCutoutCall(c);
  } catch (err) {
    report(err, "listings.cutout", { action: c.action });
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }
}
