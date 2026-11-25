import { createHmac, timingSafeEqual } from "node:crypto";
import { after, NextResponse } from "next/server";
import { handleQuestionReport, type QuestionReport } from "@/lib/handlers";
import { report } from "@/lib/report";
import { refreshTrackerIfChanged } from "@/lib/tracker";

// The "App question" workflow (FOMORentals/fomo-app-questions, with live data) reports here what it found when it looked into a question (read only).
export const maxDuration = 60;

// Signed with QUESTION_CALLBACK_SECRET by the private questions repo (live data, Jamie 25 Nov 2026), or with
// BUILD_CALLBACK_SECRET by an app repo's own "App question" workflow (looks started before the switch).
function signed(raw: string, sig: string | null): boolean {
  const secrets = [process.env.QUESTION_CALLBACK_SECRET, process.env.BUILD_CALLBACK_SECRET].map((s) => s?.trim()).filter(Boolean) as string[];
  if (!secrets.length) throw new Error("Neither QUESTION_CALLBACK_SECRET nor BUILD_CALLBACK_SECRET is set");
  if (!sig) return false;
  const got = Buffer.from(sig);
  return secrets.some((secret) => {
    const want = Buffer.from("sha256=" + createHmac("sha256", secret).update(raw).digest("hex"));
    return want.length === got.length && timingSafeEqual(want, got);
  });
}

export async function POST(req: Request) {
  const raw = await req.text();
  if (!signed(raw, req.headers.get("x-signature"))) return new NextResponse("bad signature", { status: 401 });
  let r: QuestionReport;
  try {
    r = JSON.parse(raw);
  } catch {
    return new NextResponse("not JSON", { status: 400 });
  }
  // The Request tracker tab, once the report has moved the request on (lib/tracker.ts).
  after(() => refreshTrackerIfChanged());
  try {
    await handleQuestionReport(r);
    return NextResponse.json({ ok: true });
  } catch (err) {
    report(err, "question.callback", { repo: r.repo, issue: r.issue });
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }
}
