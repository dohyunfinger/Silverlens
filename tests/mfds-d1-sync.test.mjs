import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function readText(relativePath) {
  return readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

test("MFDS key stays server-side and the Worker schedules incremental D1 sync", async () => {
  const service = await readText("backend/services/mfdsPillData.ts");
  const worker = await readText("worker/index.ts");
  const vite = await readText("vite.config.ts");

  assert.match(service, /env\.MFDS_DATA_API_KEY\?\.trim\(\)/);
  assert.match(service, /PAGES_PER_RUN = 2/);
  assert.match(service, /sync_generation/);
  assert.match(service, /DELETE FROM mfds_pills WHERE sync_generation <> \?/);
  assert.match(worker, /async scheduled\(/);
  assert.match(vite, /crons: \["17 \* \* \* \*"\]/);
  assert.doesNotMatch(service, /AIza[0-9A-Za-z_-]{20,}/);
});

test("runtime pill lookup uses D1 first and preserves identity-based fallback", async () => {
  const service = await readText("backend/services/mfdsPillData.ts");
  const gemini = await readText("backend/services/geminiService.ts");
  const migration = await readText(".openai/drizzle/0002_mfds_pill_catalog.sql");

  assert.match(service, /FROM mfds_pills/);
  assert.match(service, /rankPillCandidates\(observation, records, limit\)/);
  assert.match(service, /return findPillCandidates\(observation, limit\)/);
  assert.match(gemini, /await findRuntimePillCandidates\(observation, 5\)/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS mfds_pills/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS mfds_sync_state/);
});
