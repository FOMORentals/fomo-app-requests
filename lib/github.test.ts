import assert from "node:assert/strict";
import { test } from "node:test";
import { sharedFiles, vercelState } from "./github";

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

test("sharedFiles finds the files both changes touch, once each", () => {
  assert.deepEqual(sharedFiles(["lib/kit-prep.ts", "components/KitPrep.tsx", "lib/kit-prep.ts"], ["components/KitPrep.tsx", "lib/kit-prep.ts", "README.md"]), [
    "lib/kit-prep.ts",
    "components/KitPrep.tsx",
  ]);
  assert.deepEqual(sharedFiles(["lib/a.ts"], ["lib/b.ts"]), []);
});

test("sharedFiles ignores design notes and team-note pictures", () => {
  assert.deepEqual(sharedFiles(["docs/DESIGN.md", "whats-new/a.png", "lib/x.ts"], ["docs/DESIGN.md", "whats-new/a.png"]), []);
});
