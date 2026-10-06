import assert from "node:assert/strict";
import { readFile, rm, writeFile } from "node:fs/promises";
import test from "node:test";

/*
 * backend/data/healthTerms.ts 는 JSON 을 import 속성 없이 불러와(번들러 방식) Node 에서 바로 못 읽는다.
 * 같은 폴더에 import 속성만 붙인 임시 사본을 만들어 실제 함수를 돌려 본다.
 */
async function loadHealthTerms() {
  const sourceUrl = new URL("../backend/data/healthTerms.ts", import.meta.url);
  const tempUrl = new URL(`../backend/data/.healthTerms.test-${process.pid}.ts`, import.meta.url);
  const source = await readFile(sourceUrl, "utf8");
  await writeFile(tempUrl, source.replace(/(from "\.\.\/\.\.\/data\/[a-z0-9_]+\.json");/g, '$1 with { type: "json" };'));
  try {
    return await import(tempUrl.href);
  } finally {
    await rm(tempUrl, { force: true });
  }
}

test("only health items the user actually states are added to My info", async () => {
  const { filterStatedHealthIds: stated } = await loadHealthTerms();

  // 감귤 알레르기가 있는 분이 감귤초콜릿을 물었을 때 초콜릿을 알레르기로 넣던 문제
  assert.deepEqual(stated("감귤초콜릿 먹어도 되나요?", ["allergy_cocoa", "allergy_orange"], "allergy"), []);
  assert.deepEqual(
    stated("감귤 알레르기 있는데 초콜릿 먹어도 돼?", ["allergy_cocoa", "allergy_orange"], "allergy"),
    ["allergy_orange"],
  );
  assert.deepEqual(stated("Can I eat chocolate with oranges?", ["allergy_cocoa"], "allergy"), []);
  assert.deepEqual(stated("무엇이 알레르기에 좋아요?", ["allergy_radish"], "allergy"), []);
  assert.deepEqual(stated("당뇨에 좋은 음식 알려줘", ["condition_diabetes"], "condition"), []);

  // 직접 밝힌 경우는 그대로 받는다.
  assert.deepEqual(stated("저는 복숭아 알레르기가 있어요", ["allergy_peach"], "allergy"), ["allergy_peach"]);
  assert.deepEqual(
    stated("새우랑 게 알레르기 있어요", ["allergy_shrimp", "allergy_crab"], "allergy"),
    ["allergy_shrimp", "allergy_crab"],
  );
  assert.deepEqual(stated("새우 먹으면 두드러기가 나요", ["allergy_shrimp"], "allergy"), ["allergy_shrimp"]);
  assert.deepEqual(stated("I am allergic to peaches", ["allergy_peach"], "allergy"), ["allergy_peach"]);
  assert.deepEqual(stated("桃アレルギーがあります", ["allergy_peach"], "allergy"), ["allergy_peach"]);
  assert.deepEqual(
    stated("당뇨랑 고혈압이 있어요", ["condition_diabetes", "condition_hypertension"], "condition"),
    ["condition_diabetes", "condition_hypertension"],
  );
  assert.deepEqual(stated("고혈압약 먹고 있어요", ["condition_hypertension"], "condition"), ["condition_hypertension"]);

  // 알레르기 입력 화면처럼 맥락이 분명하면 이름만 말해도 된다.
  assert.deepEqual(
    stated("새우, 게", ["allergy_shrimp", "allergy_crab"], "allergy", { requireStatement: false }),
    ["allergy_shrimp", "allergy_crab"],
  );
});

test("chat and voice paths both pass model-picked IDs through the statement filter", async () => {
  const [chat, transcription] = await Promise.all([
    readFile(new URL("../backend/services/geminiService.ts", import.meta.url), "utf8"),
    readFile(new URL("../backend/services/transcriptionService.ts", import.meta.url), "utf8"),
  ]);
  assert.match(chat, /filterStatedHealthIds\(message, parsed\.profileAllergyIds, "allergy"\)/);
  assert.match(chat, /filterStatedHealthIds\(message, parsed\.profileConditionIds, "condition"\)/);
  assert.match(transcription, /filterStatedHealthIds\(result\.transcript, result\.allergies, "allergy"/);
  assert.match(transcription, /filterStatedHealthIds\(result\.transcript, result\.conditions, "condition"/);
});
