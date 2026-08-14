import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readText = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("about page shows official source logos and a fifth linking-code guide", async () => {
  const source = await readText("frontend/SilverLensApp.tsx");

  assert.match(source, /icon: "opendict"/);
  assert.match(source, /icon: "mfds"/);
  assert.match(source, /icon: "kpic"/);
  assert.match(source, /className={`about-source-logo/);
  assert.match(source, /source-icons\/data-go\.png/);
  assert.match(source, /brand\/silverlens-mark\.png/);
  assert.match(source, /step: "5단계"/);
  assert.match(source, /데이터에서 한국어 연결 코드를 받습니다/);
  assert.match(source, /className="about-guide-mock-link"/);
  assert.match(source, /index === 4 \? " is-link"/);
});

test("about page uses a light source panel and wraps Japanese cards", async () => {
  const css = await readText("app/globals.css");

  assert.match(css, /\.about-sources[\s\S]*?#f5faf7[\s\S]*?#edf6f1/);
  assert.match(css, /html\[lang="ja-JP"\] \.about-feature-card h3/);
  assert.match(css, /overflow-wrap: anywhere/);
  assert.match(css, /line-break: strict/);
});
