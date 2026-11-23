import { after, NextResponse } from "next/server";
import { handleInteraction } from "@/lib/handlers";
import { handleListingInteraction, isListingAction } from "@/lib/listings/handlers";
import { report } from "@/lib/report";
import { verifySlackSignature } from "@/lib/slack";

export const maxDuration = 300;

export async function POST(req: Request) {
  const raw = await req.text();
  if (!verifySlackSignature(raw, req.headers.get("x-slack-request-timestamp"), req.headers.get("x-slack-signature")))
    return new NextResponse("bad signature", { status: 401 });
  const payload = JSON.parse(new URLSearchParams(raw).get("payload") ?? "{}");
  try {
    // Website listings (/list-kit) have their own buttons and form, all named lk_…
    const body = isListingAction(payload) ? await handleListingInteraction(payload) : await handleInteraction(payload);
    if (body && "after" in body && typeof body.after === "function") {
      const work = body.after as () => Promise<void>;
      after(() => work().catch((err) => report(err, "slack.form", { callback: payload.view?.callback_id })));
      return new NextResponse(null, { status: 200 });
    }
    if (body && "body" in body && body.body) return NextResponse.json(body.body);
    return body && !("after" in body) && !("body" in body) && Object.keys(body).length ? NextResponse.json(body) : new NextResponse(null, { status: 200 });
  } catch (err) {
    report(err, "slack.interaction", { type: payload.type, action: payload.actions?.[0]?.action_id });
    if (payload.user?.id && payload.channel?.id) {
      const { slack } = await import("@/lib/slack");
      await slack("chat.postEphemeral", { channel: payload.channel.id, user: payload.user.id, text: "Sorry, that didn't work. Jamie has been told." }).catch(() => {});
    }
    return new NextResponse(null, { status: 200 });
  }
}
