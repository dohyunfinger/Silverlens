import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readText = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("about page shows official source logos and a fifth data-backup guide", async () => {
  const source = await readText("frontend/SilverLensApp.tsx");

  assert.match(source, /icon: "opendict"/);
  assert.match(source, /icon: "mfds"/);
  assert.match(source, /icon: "kpic"/);
  assert.match(source, /className={`about-source-logo/);
  assert.match(source, /source-icons\/data-go\.png/);
  assert.match(source, /brand\/silverlens-mark\.png/);
  assert.match(source, /step: "5단계"/);
  assert.match(source, /데이터를 파일로 안전하게 보관합니다/);
  assert.match(source, /className="about-guide-mock-data"/);
  assert.match(source, /index === 4 \? " is-data"/);
});

test("about hero uses a credited family photo and step five uses the backup mock", async () => {
  const [source, css, heroPhoto] = await Promise.all([
    readText("frontend/SilverLensApp.tsx"),
    readText("app/globals.css"),
    readFile(new URL("../public/about/grandparents-hero.jpg", import.meta.url)),
  ]);

  assert.match(source, /className="about-hero-photo"/);
  assert.match(source, /grandmother-laughing-with-her-grandchildren-wearing-white-DxPgOHdcwes/);
  assert.match(source, /heroPhotoCredit/);
  assert.match(css, /url\("\/about\/grandparents-hero\.jpg"\)/);
  assert.match(source, /const shotType = index === 4 \? undefined/);
  assert.deepEqual([...heroPhoto.subarray(0, 2)], [0xff, 0xd8]);
});

test("lower about sections use photo stories and colorful navigation icons", async () => {
  const [source, css, cooking, smartphone, backup] = await Promise.all([
    readText("frontend/SilverLensApp.tsx"),
    readText("app/globals.css"),
    readFile(new URL("../public/about/family-cooking.jpg", import.meta.url)),
    readFile(new URL("../public/about/senior-smartphone.jpg", import.meta.url)),
    readFile(new URL("../public/about/grandparents-hero.jpg", import.meta.url)),
  ]);

  assert.match(source, /const aboutPhotoStories/);
  assert.match(source, /className="about-photo-stories"/);
  assert.match(source, /className="about-care-story"/);
  assert.match(css, /\.about-feature-card:nth-child\(6\)/);
  assert.match(css, /\.about-workflow-card:nth-child\(4\)/);
  assert.match(css, /\.about-guide-item:nth-child\(5\)/);
  assert.match(css, /\.nav-item:nth-child\(4\) > span/);
  assert.doesNotMatch(source, /href="\/caregiver"/);
  for (const photo of [cooking, smartphone, backup]) {
    assert.deepEqual([...photo.subarray(0, 2)], [0xff, 0xd8]);
  }
});

test("about page uses a light source panel and wraps Japanese cards", async () => {
  const css = await readText("app/globals.css");

  assert.match(css, /\.about-sources[\s\S]*?#f5faf7[\s\S]*?#edf6f1/);
  assert.match(css, /html\[lang="ja-JP"\] \.about-feature-card h3/);
  assert.match(css, /overflow-wrap: anywhere/);
  assert.match(css, /line-break: strict/);
});
