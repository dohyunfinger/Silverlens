import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function readJson(relativePath) {
  return JSON.parse(
    await readFile(new URL(`../${relativePath}`, import.meta.url), "utf8"),
  );
}

const addedConditionIds = [
  "condition_menopause",
  "condition_prediabetes",
  "condition_coronary_artery_disease",
  "condition_gastritis_dyspepsia",
  "condition_fatty_liver",
  "condition_kidney_stones",
  "condition_rheumatoid_arthritis",
  "condition_periodontal_disease",
  "condition_peripheral_neuropathy",
  "condition_sleep_apnea",
  "condition_anxiety",
  "condition_vitamin_d_deficiency",
];

function normalize(value) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[\s'’"“”.,/#!$%^&*;:{}=_`~()]+/g, "");
}

test("health catalog contains all senior health additions exactly once", async () => {
  const [terms, groups] = await Promise.all([
    readJson("data/health_terms.json"),
    readJson("data/health_groups.json"),
  ]);
  const ids = terms.map((term) => term.id);
  const conditionIds = terms
    .filter((term) => term.kind === "condition")
    .map((term) => term.id);
  const conditionGroupMembers = groups
    .filter((group) => group.kind === "condition")
    .flatMap((group) => group.members);

  assert.equal(terms.filter((term) => term.kind === "allergy").length, 46);
  assert.equal(conditionIds.length, 53);
  assert.equal(new Set(ids).size, ids.length, "health IDs must be unique");
  assert.equal(
    new Set(conditionGroupMembers).size,
    conditionGroupMembers.length,
    "a condition must not appear in more than one UI group",
  );
  assert.deepEqual(
    [...conditionGroupMembers].sort(),
    [...conditionIds].sort(),
    "every condition must appear in a UI group",
  );
  for (const id of addedConditionIds) {
    assert.ok(ids.includes(id), `${id} is missing`);
  }
});

test("newly added health labels have all supported languages", async () => {
  const terms = await readJson("data/health_terms.json");
  const byId = new Map(terms.map((term) => [term.id, term]));

  for (const id of addedConditionIds) {
    const term = byId.get(id);
    assert.ok(term, `${id} is missing`);
    for (const language of ["ko-KR", "en-US", "ja-JP"]) {
      assert.ok(term.labels[language]?.trim(), `${id} has no ${language} label`);
    }
    assert.ok(term.aliases.length > 0, `${id} has no speech/search aliases`);
  }
});

test("representative speech and typed aliases resolve without ambiguity", async () => {
  const terms = (await readJson("data/health_terms.json")).filter(
    (term) => term.kind === "condition",
  );
  const samples = new Map([
    ["폐경", "condition_menopause"],
    ["완경", "condition_menopause"],
    ["혈당치 상승", "condition_prediabetes"],
    ["협심증", "condition_coronary_artery_disease"],
    ["위염", "condition_gastritis_dyspepsia"],
    ["지방간", "condition_fatty_liver"],
    ["요로결석", "condition_kidney_stones"],
    ["류마티스 관절염", "condition_rheumatoid_arthritis"],
    ["치주염", "condition_periodontal_disease"],
    ["말초신경병증", "condition_peripheral_neuropathy"],
    ["수면무호흡증", "condition_sleep_apnea"],
    ["불안장애", "condition_anxiety"],
    ["비타민D결핍증", "condition_vitamin_d_deficiency"],
  ]);

  for (const [input, expectedId] of samples) {
    const target = normalize(input);
    const matches = terms.filter((term) =>
      [
        ...Object.values(term.labels),
        ...term.aliases,
      ].some((candidate) => normalize(candidate) === target),
    );
    assert.deepEqual(
      matches.map((term) => term.id),
      [expectedId],
      `${input} must resolve to one condition`,
    );
  }
});

test("prediabetes participates in the glycemic safety rule", async () => {
  const rules = await readJson("data/safety_rules.json");
  const rule = rules.find((item) => item.id === "diabetes-glycemic-load");

  assert.ok(rule, "diabetes-glycemic-load rule is missing");
  assert.ok(rule.condition_ids.includes("condition_prediabetes"));
  assert.equal(rule.risk_floor, "caution");
});
