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

test("selected senior health information expands directly below that profile", async () => {
  const source = await readFile(
    new URL("../frontend/CaregiverApp.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /seniorDetail\?\.id === selectedSeniorId/);
  assert.match(source, /aria-expanded=\{expanded\}/);
  assert.match(source, /aria-controls=\{`care-profile-\$\{senior\.id\}`\}/);
  assert.match(source, /expanded && profile &&/);
  assert.match(source, /seniorDetail\?\.id === senior\.id && seniorDetail\.chatTurns\.length/);
});

test("caregiver chat accepts temporary photo and voice attachments", async () => {
  const app = await readFile(
    new URL("../frontend/CaregiverApp.tsx", import.meta.url),
    "utf8",
  );
  const route = await readFile(
    new URL("../app/api/caregiver/chat/route.ts", import.meta.url),
    "utf8",
  );

  assert.match(app, /accept="image\/\*"/);
  assert.match(app, /navigator\.mediaDevices\.getUserMedia\(\{ audio: true \}\)/);
  assert.match(app, /pendingImages\.map\(async \(image\)/);
  assert.match(app, /audio,\s*images,/);
  assert.match(route, /const audio =\s*isInlineMedia\(body\.audio\)/);
  assert.match(route, /const images = cleanImages\(body\.images\)/);
  assert.match(route, /\{ audio, images \}/);
  assert.match(route, /MAX_INLINE_DATA_LENGTH/);
});

test("caregiver login uses a credited senior-care photo and respectful copy", async () => {
  const [login, css] = await Promise.all([
    readFile(new URL("../frontend/CaregiverLogin.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(login, /어르신의 오늘을 이해하고/);
  assert.match(login, /어르신이 선택한 연결/);
  assert.match(login, /caregiver-login-photo-credit/);
  assert.match(login, /Age Cymru · Unsplash/);
  assert.match(
    css,
    /\.caregiver-login-root\s*\{[\s\S]*?url\("\/about\/caregiver-conversation\.jpg"\)/,
  );
  assert.match(css, /\.caregiver-login-intro\s*\{[\s\S]*?background: none/);
  assert.match(css, /\.caregiver-login-benefits[\s\S]*?backdrop-filter: blur\(10px\)/);
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
