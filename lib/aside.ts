/**
 * Side conversations (Jamie, 24 Nov 2026): once a person other than the requester joins a request's thread (Jamie
 * saying "I'm checking this one now"), the bot steps back. The requester's later replies are for that person, so the
 * bot stays quiet until someone @mentions it or taps one of its buttons. Pure, so it can be tested.
 *
 * The same goes when the requester @mentions someone else (Jamie, 25 Nov 2026: after the bot answered a question he
 * had re-asked, his "@Rosie let me know if this answers things for you" got a second answer from the bot). That
 * message is for the person mentioned, and so are the replies after it.
 */
import type { SlackMessage } from "./slack";

const isPerson = (m: SlackMessage) => !!m.user && !m.bot_id && (!m.subtype || m.subtype === "file_share" || m.subtype === "thread_broadcast");

/** True when the message @mentions a person other than the bot (Slack writes a mention as <@U123> or <@U123|name>). */
export function mentionsSomeoneElse(text: string | undefined, botUser: string): boolean {
  return [...(text ?? "").matchAll(/<@([UW][A-Z0-9]+)(?:\|[^>]*)?>/g)].some((x) => x[1] !== botUser);
}

/**
 * Whether the bot should stay out: since the bot last posted in the thread (before `beforeTs`), someone other than
 * the requester has spoken, or the requester has @mentioned someone else without mentioning the bot. `botId` is the
 * bot's bot_id, `botUser` its user id. The thread's first message (the request itself) never counts.
 */
export function steppedBack(messages: SlackMessage[], thread: string, requester: string, botId: string, beforeTs: string, botUser = ""): boolean {
  const before = messages.filter((m) => m.ts !== thread && Number(m.ts) < Number(beforeTs)).sort((a, b) => Number(a.ts) - Number(b.ts));
  let lastBot = -1;
  before.forEach((m, i) => {
    if (m.bot_id === botId) lastBot = i;
  });
  return before
    .slice(lastBot + 1)
    .some((m) => isPerson(m) && (m.user !== requester || (mentionsSomeoneElse(m.text, botUser) && !mentionsBot(m.text, botUser))));
}

/** True when the message @mentions the bot (its Slack user id). */
export function mentionsBot(text: string | undefined, botUser: string): boolean {
  return !!botUser && (text ?? "").includes(`<@${botUser}>`);
}

/**
 * True for the requester's first message after the bot stepped back, so the one-off "I've stepped back" note (seen
 * only by them) isn't repeated on every reply.
 */
export function firstSinceStepBack(messages: SlackMessage[], thread: string, requester: string, botId: string, beforeTs: string): boolean {
  const before = messages.filter((m) => m.ts !== thread && Number(m.ts) < Number(beforeTs)).sort((a, b) => Number(a.ts) - Number(b.ts));
  let lastBot = -1;
  before.forEach((m, i) => {
    if (m.bot_id === botId) lastBot = i;
  });
  const after = before.slice(lastBot + 1);
  const firstOther = after.findIndex((m) => isPerson(m) && m.user !== requester);
  return firstOther >= 0 && !after.slice(firstOther + 1).some((m) => isPerson(m) && m.user === requester);
}

export const STEP_BACK_NOTE = (who: string) =>
  `I've stepped back because ${who} has joined in, so I won't answer here. If you want me again, mention @App requests in your reply.`;
