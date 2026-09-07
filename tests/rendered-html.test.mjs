import assert from "node:assert/strict";
import test from "node:test";

const developmentPreviewMeta =
  /<meta(?=[^>]*\bname=["']codex-preview["'])(?=[^>]*\bcontent=["']development["'])[^>]*>/i;

test("starts with the introduction, then renders the senior service on return visits", async () => {
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
  assert.match(html, /사투리를 이해하는 AI/);
  assert.match(html, /지금 시작하기/);

  const returnResponse = await worker.fetch(
    new Request("http://localhost/", {
      headers: {
        accept: "text/html",
        cookie: "silverlens_service_intro_seen=1",
      },
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
  const returnHtml = await returnResponse.text();

  assert.equal(returnResponse.status, 200);
  assert.match(returnHtml, /기본설정/);
  assert.match(returnHtml, /내 정보 말하기/);
  assert.match(returnHtml, /내 정보 입력하기/);
  assert.match(returnHtml, /class="quick-ask-strip"/);
  assert.doesNotMatch(returnHtml, /class="profile-lang/);
  assert.doesNotMatch(returnHtml, /class="chat-quick-profile-head"/);
  assert.ok(
    returnHtml.indexOf('class="quick-ask-strip"') <
      returnHtml.indexOf("<h1"),
  );
  assert.doesNotMatch(returnHtml, /class="chat-quick-row"/);
  assert.doesNotMatch(returnHtml, /href=["']\/caregiver/);
  assert.doesNotMatch(returnHtml, /돌봄이 화면/);
  assert.doesNotMatch(returnHtml, /로그인|회원가입/);
});
