import assert from "node:assert/strict";
import test from "node:test";
import postcss from "postcss";
import mobileOnlyMedia from "../build/mobile-only-media.mjs";

const run = async (css) => (await postcss([mobileOnlyMedia()]).process(css, { from: undefined })).css;

test("screen rules are resolved for a phone so PC shows the phone layout", async () => {
  // 휴대폰에서 참인 조건은 벗겨서 늘 적용한다.
  assert.equal(await run("@media (max-width: 700px) { .a { color: red; } }"), " .a { color: red; }");
  assert.match(await run("@media (max-width: 1180px), (hover: none) and (pointer: coarse) { .b { x: 1 } }"), /^\s*\.b \{ x: 1 \}$/);
  // 넓은 화면 전용 조건은 지운다.
  assert.equal((await run("@media (min-width: 1024px) { .c { x: 1 } }")).trim(), "");
  // 휴대폰보다 좁은 화면 조건과 폭과 무관한 조건은 그대로 둔다.
  assert.match(await run("@media (max-width: 380px) { .d { x: 1 } }"), /@media \(max-width: 380px\)/);
  assert.match(await run("@media (prefers-reduced-motion: reduce) { .e { x: 1 } }"), /prefers-reduced-motion/);
  // PC에서 휴대폰 폭 기둥을 만드는 조건은 압축으로 공백이 빠져도 남아야 한다.
  assert.match(await run("@media (min-width: 521px) { body { width: 430px } }"), /@media \(min-width: 521px\)/);
  assert.match(await run("@media (min-width:521px) { body { width: 430px } }"), /@media \(min-width:521px\)/);
});
