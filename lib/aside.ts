/**
 * Side conversations (Jamie, 24 Nov 2026): once a person other than the requester joins a request's thread (Jamie
 * saying "I'm checking this one now"), the bot steps back. The requester's later replies are for that person, so the
 * bot stays quiet until someone @mentions it or taps one of its buttons. Pure, so it can be tested.
 */
import type { SlackMessage } from "./slack";

const isPerson = (m: SlackMessage) => !!m.user && !m.bot_id && (!m.subtype || m.subtype === "file_share" || m.subtype === "thread_broadcast");

/**
 * Whether someone other than the requester has spoken since the bot last posted in the thread, before `beforeTs`.
 * `botId` is the bot's bot_id. The thread's first message (the request itself) never counts.
 */
export function steppedBack(messages: SlackMessage[], thread: string, requester: string, botId: string, beforeTs: string): boolean {
  const before = messages.filter((m) => m.ts !== thread && Number(m.ts) < Number(beforeTs)).sort((a, b) => Number(a.ts) - Number(b.ts));
  let lastBot = -1;
  before.forEach((m, i) => {
    if (m.bot_id === botId) lastBot = i;
  });
  return before.slice(lastBot + 1).some((m) => isPerson(m) && m.user !== requester);
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
