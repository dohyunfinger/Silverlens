import assert from "node:assert/strict";
import test from "node:test";

const developmentPreviewMeta =
  /<meta(?=[^>]*\bname=["']codex-preview["'])(?=[^>]*\bcontent=["']development["'])[^>]*>/i;

test("renders development preview metadata", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  const response = await worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );

  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("content-type") ?? "",
    /^text\/html\b/i,
  );
  assert.match(await response.text(), developmentPreviewMeta);
});

test("renders the caregiver entry link and dedicated caregiver screen", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("caregiver-test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  const environment = {
    ASSETS: {
      fetch: async () => new Response("Not found", { status: 404 }),
    },
  };
  const context = {
    waitUntil() {},
    passThroughOnException() {},
  };

  const seniorResponse = await worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    environment,
    context,
  );
  const seniorHtml = await seniorResponse.text();

  assert.equal(seniorResponse.status, 200);
  assert.match(seniorHtml, /href=["']\/caregiver["']/);
  assert.match(seniorHtml, /돌봄이 화면/);

  const caregiverResponse = await worker.fetch(
    new Request("http://localhost/caregiver", {
      headers: { accept: "text/html" },
    }),
    environment,
    context,
  );
  const caregiverHtml = await caregiverResponse.text();

  assert.equal(caregiverResponse.status, 200);
  assert.match(caregiverHtml, /오늘 어떤 돌봄이 필요하신가요\?/);
  assert.match(caregiverHtml, /돌봄에 관해 무엇이든 물어보세요/);
  assert.match(caregiverHtml, /시니어 화면으로 돌아가기/);
});
