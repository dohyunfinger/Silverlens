import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readText = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("about page shows official source logos and a fifth past-chats guide", async () => {
  const source = await readText("frontend/SilverLensApp.tsx");

  assert.match(source, /icon: "opendict"/);
  assert.match(source, /icon: "mfds"/);
  assert.match(source, /icon: "kpic"/);
  assert.match(source, /className={`about-source-logo/);
  assert.match(source, /source-icons\/data-go\.png/);
  assert.match(source, /brand\/silverlens-mark\.png/);
  assert.match(source, /step: "5단계"/);
  // 다섯째 단계는 메뉴에서 실제로 찾아갈 수 있는 "이전 대화"를 안내한다.
  assert.match(source, /지난 대화는 '이전 대화'에서 다시 봅니다/);
  assert.match(source, /className="about-guide-mock-data"/);
  assert.match(source, /index === 4 \? " is-data"/);
  assert.match(source, /className="about-temp-reset"/);
  assert.match(source, /onClick=\{\(\) => void clearSavedData\(\)\}/);
  assert.ok(
    source.indexOf('className="about-temp-reset"') >
      source.indexOf('className="about-legal"'),
  );
});

test("about hero uses a credited family photo and every guide step uses a real screenshot", async () => {
  const [source, css, heroPhoto] = await Promise.all([
    readText("frontend/SilverLensApp.tsx"),
    readText("app/globals.css"),
    readFile(new URL("../public/about/grandparents-hero.jpg", import.meta.url)),
  ]);

  assert.match(source, /className="about-hero-photo"/);
  assert.match(source, /grandmother-laughing-with-her-grandchildren-wearing-white-DxPgOHdcwes/);
  assert.match(source, /heroPhotoCredit/);
  assert.match(css, /url\("\/about\/grandparents-hero\.jpg"\)/);
  assert.match(source, /const shotType = ABOUT_GUIDE_SHOT_TYPES\[typeIndex\];/);
  for (let step = 1; step <= 5; step += 1) {
    const shot = await readFile(new URL(`../public/guide/step-${step}.jpg`, import.meta.url));
    assert.deepEqual([...shot.subarray(0, 2)], [0xff, 0xd8]);
  }
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
