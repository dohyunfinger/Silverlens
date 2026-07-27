import assert from "node:assert/strict";
import test from "node:test";

const developmentPreviewMeta =
  /<meta(?=[^>]*\bname=["']codex-preview["'])(?=[^>]*\bcontent=["']development["'])[^>]*>/i;

async function loadWorker() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker;
}

const workerEnvironment = {
  ASSETS: {
    fetch: async () => new Response("Not found", { status: 404 }),
  },
};

const workerContext = {
  waitUntil() {},
  passThroughOnException() {},
};

test("renders development preview metadata", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    workerEnvironment,
    workerContext,
  );

  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("content-type") ?? "",
    /^text\/html\b/i,
  );
  assert.match(await response.text(), developmentPreviewMeta);
});

test("redirects a Korean racing question without answering it", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(
    new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message: "지금 레드불 레이싱 선수가 누구야?",
        profile: { language: "ko-KR" },
      }),
    }),
    workerEnvironment,
    workerContext,
  );
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.riskLevel, "safe");
  assert.equal(payload.warningMessage, "");
  assert.match(payload.answer, /시니어 식품 관련 정보 AI/);
  assert.doesNotMatch(payload.answer, /막스|베르스타펜|드라이버|선수는/);
});

test("localizes the off-topic redirect to the selected language", async () => {
  const worker = await loadWorker();
  const response = await worker.fetch(
    new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message: "Who is the Red Bull Racing driver?",
        profile: { language: "en-US" },
      }),
    }),
    workerEnvironment,
    workerContext,
  );
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.match(payload.answer, /senior food information/i);
  assert.doesNotMatch(payload.answer, /Verstappen|driver is/i);
});
