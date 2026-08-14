import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readText = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("persists introduction completion without storing senior data in the cookie", async () => {
  const [page, app, shared] = await Promise.all([
    readText("app/page.tsx"),
    readText("frontend/SilverLensApp.tsx"),
    readText("shared/serviceIntro.ts"),
  ]);

  assert.match(page, /cookies\(\)/);
  assert.match(page, /initialIntroSeen/);
  assert.match(app, /initialIntroSeen \? "chat" : "about"/);
  assert.match(app, /rememberServiceIntroSeen\(\)/);
  assert.match(app, /setIntroSeen\(true\)/);
  assert.match(app, /if \(!storeReady \|\| !introSeen\) return/);
  assert.match(shared, /silverlens_service_intro_seen/);
  assert.doesNotMatch(shared, /health|allergy|condition|chat/i);
});
