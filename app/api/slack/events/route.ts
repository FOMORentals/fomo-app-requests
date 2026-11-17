import { after, NextResponse } from "next/server";
import { handleEvent } from "@/lib/handlers";
import { report } from "@/lib/report";
import { verifySlackSignature } from "@/lib/slack";

// Claude reads the thread after Slack has had its answer (Slack wants one within 3 seconds).
export const maxDuration = 300;

export async function POST(req: Request) {
  const raw = await req.text();
  if (!verifySlackSignature(raw, req.headers.get("x-slack-request-timestamp"), req.headers.get("x-slack-signature")))
    return new NextResponse("bad signature", { status: 401 });
  const body = JSON.parse(raw);
  if (body.type === "url_verification") return NextResponse.json({ challenge: body.challenge });
  // Slack retries when it thinks we were slow. We always answer at once, so a retry is a duplicate.
  if (req.headers.get("x-slack-retry-num")) return new NextResponse(null, { status: 200 });
  if (body.type === "event_callback") {
    after(() => handleEvent(body.event).catch((err) => report(err, "slack.event", { type: body.event?.type, ts: body.event?.ts })));
  }
  return new NextResponse(null, { status: 200 });
}
