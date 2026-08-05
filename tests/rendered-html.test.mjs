import assert from "node:assert/strict";
import test from "node:test";

const developmentPreviewMeta =
  /<meta(?=[^>]*\bname=["']codex-preview["'])(?=[^>]*\bcontent=["']development["'])[^>]*>/i;

test("renders production metadata and the simplified senior navigation", async () => {
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
  const html = await response.text();
  assert.doesNotMatch(html, developmentPreviewMeta);
  assert.match(html, /<title>실버렌즈 \| 시니어 식생활 AI<\/title>/);
  assert.match(html, /<meta property="og:image" content="https:\/\/silverlens\.ogq\.workers\.dev\/og\.png"/);
  assert.match(html, /기본설정/);
  assert.match(html, /데이터/);
  assert.match(html, /내 정보 말하기/);
  assert.match(html, /내 정보 입력하기/);
  assert.doesNotMatch(html, /class="chat-quick-row"/);
});

test("renders the caregiver entry link and authentication screens", async () => {
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
  assert.match(caregiverHtml, /Google로 계속하기/);
  assert.match(caregiverHtml, /href=["']\/caregiver\/signup["']/);
  assert.match(caregiverHtml, /시니어 화면으로 돌아가기/);

  const signupResponse = await worker.fetch(
    new Request("http://localhost/caregiver/signup", {
      headers: { accept: "text/html" },
    }),
    environment,
    context,
  );
  const signupHtml = await signupResponse.text();

  assert.equal(signupResponse.status, 200);
  assert.match(signupHtml, /돌봄이 계정을 만든 뒤/);
  assert.match(signupHtml, /개인정보 수집 및 이용에 동의합니다/);
  assert.match(signupHtml, /로그인으로 돌아가기/);
});
