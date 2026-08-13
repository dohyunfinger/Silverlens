import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("caregiver questions bypass the senior topic gate but keep grounded context rules", async () => {
  const source = await readFile(
    new URL("../backend/services/geminiService.ts", import.meta.url),
    "utf8",
  );

  assert.match(
    source,
    /!isCaregiverAudience\s*&&\s*!hasMedia[\s\S]*?!isLikelyOnTopic/,
  );
  assert.match(source, /돌봄이의 질문은 음식·건강으로 주제를 제한하지 마세요/);
  assert.match(source, /시니어 앱 최근 대화/);
  assert.match(source, /최근 대화에 없는 사실이나 시니어의 의도·감정·증상을 추측하지 마세요/);
  assert.match(source, /의학적 진단이나 치료 지시를 하지 말고/);
});

test("caregiver prompt receives linked senior history and thread deletion checks ownership", async () => {
  const careData = await readFile(
    new URL("../backend/services/careData.ts", import.meta.url),
    "utf8",
  );
  const route = await readFile(
    new URL("../app/api/caregiver/threads/[threadId]/route.ts", import.meta.url),
    "utf8",
  );

  assert.match(careData, /getCaregiverSeniorDetail\(input\.caregiverUid, seniorId\)/);
  assert.match(careData, /seniorHistory:[\s\S]*?slice\(-12\)/);
  assert.match(
    careData,
    /SELECT id FROM caregiver_threads WHERE id = \? AND caregiver_uid = \?/,
  );
  assert.match(route, /isSameOriginMutation\(request\)/);
  assert.match(route, /deleteCaregiverThread\(caregiver\.uid, threadId\)/);
});

test("caregiver thread deletion rejects an unauthenticated request", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("delete-auth-test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const response = await worker.fetch(
    new Request("http://localhost/api/caregiver/threads/not-owned", {
      method: "DELETE",
      headers: { origin: "http://localhost" },
    }),
    {
      ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
    },
    { waitUntil() {}, passThroughOnException() {} },
  );

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "로그인이 필요합니다." });
});
