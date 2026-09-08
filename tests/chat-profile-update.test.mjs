import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readText = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("typed chat adds only catalog health IDs to basic settings", async () => {
  const [app, service, route] = await Promise.all([
    readText("frontend/SilverLensApp.tsx"),
    readText("backend/services/geminiService.ts"),
    readText("app/api/chat/route.ts"),
  ]);

  assert.match(service, /profile_allergy_ids/);
  assert.match(service, /profile_condition_ids/);
  assert.match(service, /isHealthTermId\(kind, id\)/);
  assert.match(service, /다른 사람의 정보, 단순 질문, 가정/);
  assert.match(route, /profileAllergyIds: result\.profileAllergyIds/);
  assert.match(route, /profileConditionIds: result\.profileConditionIds/);
  assert.match(app, /setAllergyIds\(\(current\) => uniqueItems\(\[\.\.\.current, \.\.\.addedAllergyIds\]\)\)/);
  assert.match(app, /setConditionIds\(\(current\) => uniqueItems\(\[\.\.\.current, \.\.\.addedConditionIds\]\)\)/);
});

test("selecting the final setup age moves focus to the completion button", async () => {
  const app = await readText("frontend/SilverLensApp.tsx");

  assert.match(app, /const setupCompletionRef = useRef<HTMLButtonElement \| null>\(null\)/);
  assert.match(app, /setupCompletionRef\.current\?\.scrollIntoView/);
  assert.match(app, /setupCompletionRef\.current\?\.focus/);
  assert.match(app, /ref=\{setupCompletionRef\}/);
});
