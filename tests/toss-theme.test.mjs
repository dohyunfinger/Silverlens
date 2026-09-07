import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("uses the senior-friendly minimal card theme across service screens", async () => {
  const css = await readFile(
    new URL("../app/globals.css", import.meta.url),
    "utf8",
  );

  assert.match(css, /--toss-blue: #1b64da;/);
  assert.match(css, /--toss-bg: #f2f4f6;/);
  assert.match(css, /\.app-shell \{[\s\S]*?border-radius: 30px;/);
  assert.match(css, /\.nav-item\.active \{[\s\S]*?background: var\(--toss-blue-soft\);/);
  assert.match(css, /\.quick-ask-strip,[\s\S]*?\.data-screen-header \{[\s\S]*?background: var\(--toss-surface\);/);
  assert.match(css, /\.about-accent,[\s\S]*?-webkit-text-fill-color: currentColor;/);
  assert.match(css, /\.about-panel-cta \{[\s\S]*?var\(--toss-blue-deep\)/);
  assert.match(css, /\.about-guide-mock,[\s\S]*?background: #191f28;/);
  assert.match(css, /@media \(max-width: 900px\) \{[\s\S]*?\.app-shell \{[\s\S]*?border-radius: 0;/);
  assert.match(css, /@media \(max-width: 620px\) \{[\s\S]*?min-height: clamp\(300px, 48svh, 430px\);/);
  assert.match(css, /font-family: Pretendard,[\s\S]*?font-weight: 500;/);
});
