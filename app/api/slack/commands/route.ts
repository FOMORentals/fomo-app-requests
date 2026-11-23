import { after, NextResponse } from "next/server";
import { handleGrillCommand } from "@/lib/grill/handlers";
import { handleCommand } from "@/lib/listings/handlers";
import { report } from "@/lib/report";
import { verifySlackSignature } from "@/lib/slack";

// `/list-kit` (website listings) and `/grill` (Sam's grill), Jamie 23 Nov 2026. Slack wants an answer within 3 seconds;
// the slow part (Rentman, or Claude) runs afterwards.
export const maxDuration = 300;

export async function POST(req: Request) {
  const raw = await req.text();
  if (!verifySlackSignature(raw, req.headers.get("x-slack-request-timestamp"), req.headers.get("x-slack-signature")))
    return new NextResponse("bad signature", { status: 401 });
  const p = Object.fromEntries(new URLSearchParams(raw));
  try {
    if (p.command !== "/list-kit" && p.command !== "/grill") return NextResponse.json({ response_type: "ephemeral", text: "I don't know that command." });
    const r = p.command === "/grill" ? await handleGrillCommand(p) : await handleCommand(p);
    if (r.after) {
      const work = r.after;
      after(() => work().catch((err) => report(err, "slack.command", { command: p.command })));
    }
    return NextResponse.json(r.body ?? {});
  } catch (err) {
    report(err, "slack.command", { command: p.command });
    return NextResponse.json({ response_type: "ephemeral", text: "Sorry, that didn't work. Jamie has been told." });
  }
}
