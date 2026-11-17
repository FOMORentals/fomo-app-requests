import assert from "node:assert/strict";
import { test } from "node:test";
import { addWorkingDays, isMorningSlot, isWorkingDay, londonDate } from "./time";

const at = (s: string) => Date.parse(s);

test("one working day after Friday 16:00 is Monday 16:00", () => {
  assert.equal(addWorkingDays(at("2026-11-20T16:00:00Z"), 1), at("2026-11-23T16:00:00Z"));
});

test("three working days after Wednesday is Monday", () => {
  assert.equal(addWorkingDays(at("2026-11-18T10:00:00Z"), 3), at("2026-11-23T10:00:00Z"));
});

test("something asked on Saturday counts from Monday", () => {
  assert.equal(addWorkingDays(at("2026-11-21T12:00:00Z"), 1), at("2026-11-24T12:00:00Z"));
});

test("weekends are not working days", () => {
  assert.equal(isWorkingDay(at("2026-11-21T12:00:00Z")), false);
  assert.equal(isWorkingDay(at("2026-11-23T12:00:00Z")), true);
});

test("the morning slot is 09:00–09:14 London on working days, in winter and summer time", () => {
  assert.equal(isMorningSlot(at("2026-11-18T09:07:00Z")), true); // GMT
  assert.equal(isMorningSlot(at("2026-11-18T09:15:00Z")), false);
  assert.equal(isMorningSlot(at("2026-07-15T08:07:00Z")), true); // BST: 09:07 London
  assert.equal(isMorningSlot(at("2026-11-21T09:07:00Z")), false); // Saturday
});

test("London date crosses midnight in London, not UTC", () => {
  assert.equal(londonDate(at("2026-07-15T23:30:00Z")), "2026-07-16");
  assert.equal(londonDate(at("2026-11-15T23:30:00Z")), "2026-11-15");
});
