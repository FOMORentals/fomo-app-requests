/** Side conversations: the bot steps back once someone else joins in (Jamie, 24 Nov 2026). */
import assert from "node:assert/strict";
import { test } from "node:test";
import { firstSinceStepBack, mentionsBot, mentionsSomeoneElse, steppedBack } from "./aside";
import type { SlackMessage } from "./slack";

const BOT = "B1";
const m = (ts: number, who: string): SlackMessage => (who === "bot" ? { ts: String(ts), bot_id: BOT, text: "x" } : { ts: String(ts), user: who, text: "x" });
// Rosie's quote 12812 thread: request, bot answers, Jamie "I'm checking this one now", Rosie replies to Jamie.
const rosie = [m(1, "ROSIE"), m(2, "bot"), m(3, "bot"), m(4, "JAMIE"), m(5, "ROSIE")];

test("once Jamie joins in, Rosie's reply to him doesn't wake the bot", () => {
  assert.equal(steppedBack(rosie, "1", "ROSIE", BOT, "5"), true);
});

test("with only the requester and the bot, the bot carries on", () => {
  assert.equal(steppedBack([m(1, "ROSIE"), m(2, "bot"), m(3, "ROSIE")], "1", "ROSIE", BOT, "3"), false);
});

test("after the bot posts again (a button was tapped, or it was mentioned) it's back in", () => {
  assert.equal(steppedBack([...rosie, m(6, "bot"), m(7, "ROSIE")], "1", "ROSIE", BOT, "7"), false);
});

test("an @mention of the bot brings it back", () => {
  assert.equal(mentionsBot("<@UBOT> can you look again?", "UBOT"), true);
  assert.equal(mentionsBot("thanks Jamie", "UBOT"), false);
  assert.equal(mentionsBot("x", ""), false);
});

test("the 'I've stepped back' note goes once, on the requester's first reply", () => {
  assert.equal(firstSinceStepBack(rosie, "1", "ROSIE", BOT, "5"), true);
  assert.equal(firstSinceStepBack([...rosie, m(6, "JAMIE"), m(7, "ROSIE")], "1", "ROSIE", BOT, "7"), false);
});

// Jamie, 25 Nov 2026: Jamie re-asked Rosie's question, the bot answered, Jamie wrote "@Rosie let me know if this
// answers things for you" and the bot answered again.
test("the requester @mentioning someone else is not for the bot", () => {
  assert.equal(mentionsSomeoneElse("<@UROSIE> let me know if this answers things for you", "UBOT"), true);
  assert.equal(mentionsSomeoneElse("<@UROSIE|rosie> thoughts?", "UBOT"), true);
  assert.equal(mentionsSomeoneElse("<@UBOT> can you look again?", "UBOT"), false);
  assert.equal(mentionsSomeoneElse("still not clear, why?", "UBOT"), false);
});

test("after the requester @mentions someone else, their next replies stay with that person", () => {
  const t = [m(1, "JAMIE"), m(2, "bot"), { ts: "3", user: "JAMIE", text: "<@UROSIE> let me know" }, m(4, "JAMIE")];
  assert.equal(steppedBack(t, "1", "JAMIE", BOT, "4", "UBOT"), true);
  const both = [m(1, "JAMIE"), m(2, "bot"), { ts: "3", user: "JAMIE", text: "<@UROSIE> <@UBOT> both have a look" }, m(4, "JAMIE")];
  assert.equal(steppedBack(both, "1", "JAMIE", BOT, "4", "UBOT"), false);
});
