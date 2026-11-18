import assert from "node:assert/strict";
import { test } from "node:test";
import { vercelState } from "./github";

test("vercelState: live once every Vercel project on the commit is done", () => {
  assert.deepEqual(vercelState([]), { state: "none", url: "" });
  assert.equal(vercelState([{ context: "Design notes", state: "success" }]).state, "none");
  const a = { context: "Vercel – fomo-overtime", state: "success", target_url: "https://vercel.com/a" };
  assert.deepEqual(vercelState([a]), { state: "success", url: "https://vercel.com/a" });
  assert.equal(vercelState([a, { context: "Vercel – fomo-overtime-er1e", state: "pending" }]).state, "pending");
  assert.deepEqual(vercelState([a, { context: "Vercel", state: "failure", target_url: "https://vercel.com/b" }]), {
    state: "failure",
    url: "https://vercel.com/b",
  });
});
