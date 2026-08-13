import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function readText(relativePath) {
  return readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

async function readJson(relativePath) {
  return JSON.parse(await readText(relativePath));
}

test("drug photo reference uses official identification fields and safe decision rules", async () => {
  const reference = await readJson("data/drug_identification_reference.json");
  const fieldIds = reference.observation_fields.map((field) => field.id);

  for (const id of [
    "product_text",
    "imprint_front",
    "imprint_back",
    "dosage_form",
    "shape",
    "color_front",
    "color_back",
    "score_line_front",
    "score_line_back",
  ]) {
    assert.ok(fieldIds.includes(id), `${id} is missing`);
  }
  assert.ok(
    reference.decision_rules.some((rule) => rule.includes("색과 모양만")),
    "appearance-only identification must be prohibited",
  );
  assert.equal(reference.metadata.sources[0].publisher, "식품의약품안전처");
  assert.match(reference.metadata.sources[0].url, /data\.go\.kr/);
});

test("pill catalog is normalized from the reusable MFDS source", async () => {
  const catalog = await readJson("data/mfds_pill_identification.json");
  assert.equal(catalog.metadata.license, "이용허락범위 제한 없음");
  assert.ok(Array.isArray(catalog.records));

  for (const record of catalog.records.slice(0, 20)) {
    assert.equal(typeof record.itemSeq, "string");
    assert.equal(typeof record.itemName, "string");
    assert.equal(typeof record.imprintFront, "string");
    assert.equal(typeof record.shape, "string");
    assert.equal(typeof record.imageUrl, "string");
  }
});

test("backend requires text identity before shape and color can rank a pill", async () => {
  const source = await readText("backend/data/loadData.ts");
  const promptSource = await readText("backend/services/geminiService.ts");

  assert.match(source, /제품명이나 각인이 전혀 맞지 않으면 색·모양만으로 후보를 만들지 않는다/);
  assert.match(source, /identityScore === 0/);
  assert.match(promptSource, /앞뒷면 각인, 모양, 색, 제형, 분할선을 순서대로 관찰/);
  assert.match(promptSource, /식약처 후보가 비어 있으면 특정 제품명을 새로 만들어 말하지 마세요/);
});

test("sync script targets the current MFDS API and never stores its key", async () => {
  const source = await readText("scripts/sync-mfds-pill-data.mjs");

  assert.match(source, /MdcinGrnIdntfcInfoService03\/getMdcinGrnIdntfcInfoList03/);
  assert.match(source, /process\.env\.MFDS_DATA_API_KEY/);
  assert.doesNotMatch(source, /metadata:[\s\S]{0,300}apiKey/);
});
