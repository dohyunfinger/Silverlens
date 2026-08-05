import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("allergy guidance keeps seasoning and flour substitutions separate", async () => {
  const source = await readFile(
    new URL("../backend/services/geminiService.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /알레르기 정보만으로 소금처럼 무관한 재료까지 금지하지 마세요/);
  assert.match(source, /밀가루는 반죽·튀김옷·농도용 재료이지 간을 맞추는 양념이 아니므로/);
  assert.match(source, /밀 알레르기에는 밀가루가 필요한 자리만 쌀가루·감자전분/);
  assert.match(source, /나트륨 제한 근거가 등록되어 있지 않다면 소금을 임의로 금지하지 마세요/);
  assert.match(source, /간장도 밀·대두 알레르기 여부와 나트륨 제한을 각각 확인/);
});
