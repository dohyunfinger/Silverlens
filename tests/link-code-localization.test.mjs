import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readText = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("link codes use a word dictionary matching the senior UI language", async () => {
  const source = await readText("backend/services/careData.ts");

  assert.match(source, /const KOREAN_CODE_WORDS/);
  assert.match(source, /const ENGLISH_CODE_WORDS/);
  assert.match(source, /const JAPANESE_CODE_WORDS/);
  assert.match(source, /"ko-KR": KOREAN_CODE_WORDS/);
  assert.match(source, /"en-US": ENGLISH_CODE_WORDS/);
  assert.match(source, /"ja-JP": JAPANESE_CODE_WORDS/);
  assert.match(source, /randomCode\(language: LinkCodeLanguage\)/);
  assert.match(source, /ぁ-ゖァ-ヺー/);
});

test("senior link request sends the selected language and explains its script", async () => {
  const panel = await readText("frontend/SeniorCareLinkPanel.tsx");
  const route = await readText("app/api/senior/link/route.ts");

  assert.match(panel, /language,\s*\n\s*snapshot/);
  assert.match(panel, /Create English linking code/);
  assert.match(panel, /English words and numbers/);
  assert.match(panel, /日本語の連携コードを作る/);
  assert.match(panel, /ひらがなの単語と数字/);
  assert.doesNotMatch(panel, /Create Korean word code/);
  assert.doesNotMatch(panel, /韓国語の連携コードを作る/);
  assert.match(route, /language: body\.language/);
});
