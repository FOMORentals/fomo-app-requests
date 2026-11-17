import { after, NextResponse } from "next/server";
import { handleInteraction } from "@/lib/handlers";
import { report } from "@/lib/report";
import { verifySlackSignature } from "@/lib/slack";

export const maxDuration = 300;

export async function POST(req: Request) {
  const raw = await req.text();
  if (!verifySlackSignature(raw, req.headers.get("x-slack-request-timestamp"), req.headers.get("x-slack-signature")))
    return new NextResponse("bad signature", { status: 401 });
  const payload = JSON.parse(new URLSearchParams(raw).get("payload") ?? "{}");
  try {
    const body = await handleInteraction(payload);
    if (body && "after" in body && typeof body.after === "function") {
      const work = body.after as () => Promise<void>;
      after(() => work().catch((err) => report(err, "slack.form", { callback: payload.view?.callback_id })));
      return new NextResponse(null, { status: 200 });
    }
    return body ? NextResponse.json(body) : new NextResponse(null, { status: 200 });
  } catch (err) {
    report(err, "slack.interaction", { type: payload.type, action: payload.actions?.[0]?.action_id });
    if (payload.user?.id && payload.channel?.id) {
      const { slack } = await import("@/lib/slack");
      await slack("chat.postEphemeral", { channel: payload.channel.id, user: payload.user.id, text: "Sorry, that didn't work. Jamie has been told." }).catch(() => {});
    }
    return new NextResponse(null, { status: 200 });
  }
}
