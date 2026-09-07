import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readText = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("keeps mobile navigation and primary controls inside the viewport", async () => {
  const [app, css] = await Promise.all([
    readText("frontend/SilverLensApp.tsx"),
    readText("app/globals.css"),
  ]);

  assert.doesNotMatch(app, /profile-lang/);
  assert.doesNotMatch(app, /먼저 알려주시면 더 정확해요/);
  assert.match(app, /className="quick-ask-strip"/);
  assert.match(app, /className="setup-progress-index"/);
  assert.match(css, /grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(css, /html \{[\s\S]*?overflow-x: hidden;/);
  assert.match(css, /\.quick-ask-strip \{[\s\S]*?overflow: hidden;/);
  assert.match(css, /\.quick-asks\.compact[\s\S]*?display: flex;[\s\S]*?overflow-x: auto;/);
  assert.match(css, /\.setup-progress \{[\s\S]*?border-bottom: 4px solid/);
  assert.match(css, /\.setup-progress button \{[\s\S]*?min-height: 46px;[\s\S]*?border: 0;/);
  assert.match(css, /input::-webkit-slider-thumb[\s\S]*?width: 34px;/);
  assert.match(css, /\.about-bar-brand-text,[\s\S]*?display: none;/);
});
