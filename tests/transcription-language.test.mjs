import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readText = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("keeps voice transcripts in the selected language and script", async () => {
  const [app, service, route] = await Promise.all([
    readText("frontend/SilverLensApp.tsx"),
    readText("backend/services/transcriptionService.ts"),
    readText("app/api/transcribe/route.ts"),
  ]);

  assert.match(app, /JSON\.stringify\(\{ audio, purpose, language: activeLanguage \}\)/);
  assert.match(service, /Write transcript in English using the Latin alphabet exactly as spoken/);
  assert.match(service, /聞こえた日本語を漢字・ひらがな・カタカナでそのまま書き起こしてください/);
  assert.match(service, /transcript는 말한 내용을 원문 문자로 적고, 번역·의역·요약하지 마세요/);
  assert.match(service, /transcript의 표현이나 언어를 한국어 표준 이름으로 바꾸지 마세요/);
  assert.match(service, /실제로 들리지 않은 음식·식재료·제품 이름을 문맥으로 만들어 내지 마세요/);
  assert.match(service, /confidence < 0\.8/);
  assert.match(service, /usesWrongDominantScript\(transcript, selectedLanguage\)/);
  assert.match(route, /retryRequired: true/);
  assert.match(route, /status: 422/);
  assert.match(app, /audio: null/);
});
