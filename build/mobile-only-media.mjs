/**
 * 휴대폰 화면 하나로 통일하는 PostCSS 플러그인.
 *
 * 이용자 대부분이 휴대폰으로 들어오므로 PC에서도 휴대폰 화면을 그대로 보여 준다.
 * app/globals.css 의 화면 폭 조건(@media)을 "폭이 휴대폰(PHONE_WIDTH)일 때" 기준으로 미리 계산해 둔다.
 *
 *   (max-width: 700px) 처럼 휴대폰에서 참인 조건  → 항상 적용
 *   (min-width: 761px) 처럼 넓은 화면에서만 참인 조건 → 적용하지 않음
 *   (max-width: 380px) 처럼 휴대폰보다 좁은 조건   → 그대로 둔다(작은 휴대폰에서만 적용)
 *
 * 원본 CSS 는 건드리지 않으므로, 이 플러그인을 postcss.config.mjs 에서 빼면 예전 PC 화면으로 돌아간다.
 * PC에서 화면을 휴대폰 폭 가운데로 모으는 규칙(FRAME_QUERY)은 실제 화면 폭으로 판단해야 해서 계산하지 않는다.
 */
const PHONE_WIDTH = 430;
export const FRAME_QUERY = "(min-width: 521px)";

const WIDTH_FEATURE = /\(\s*(min|max)-width\s*:\s*(\d+(?:\.\d+)?)px\s*\)/g;

/** 쉼표로 나뉜 조건 하나를 휴대폰 폭 기준으로 계산한다. null 이면 휴대폰에서 거짓. */
function resolveQuery(query) {
  let never = false;
  const rest = query.replace(WIDTH_FEATURE, (feature, kind, value) => {
    const width = Number(value);
    if (kind === "min") {
      if (width > PHONE_WIDTH) never = true;
      return width > PHONE_WIDTH ? feature : "";
    }
    // 휴대폰보다 좁은 화면 조건은 실제 기기에서 판단하게 남긴다.
    return width >= PHONE_WIDTH ? "" : feature;
  });
  if (never) return null;
  const cleaned = rest
    .replace(/\band\s+(?=\band\b|$)/g, "")
    .replace(/^\s*and\s+/, "")
    .replace(/\s+and\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned === "" || cleaned === "screen" ? "all" : cleaned;
}

export default function mobileOnlyMedia() {
  return {
    postcssPlugin: "silverlens-mobile-only-media",
    AtRule: {
      media(atRule) {
        const params = atRule.params.trim();
        // 배포 빌드에서는 압축되어 공백이 빠진 "(min-width:521px)"로 들어온다. 공백을 무시하고 비교한다.
        const isFrameQuery = params.replace(/\s+/g, "") === FRAME_QUERY.replace(/\s+/g, "");
        if (isFrameQuery || !/(min|max)-width/.test(params)) return;
        const queries = params
          .split(",")
          .map((query) => resolveQuery(query.trim()))
          .filter((query) => query !== null);
        if (queries.length === 0) {
          atRule.remove();
          return;
        }
        if (queries.includes("all")) {
          // 휴대폰에서 늘 참이면 감싼 조건을 벗겨 그 자리에 규칙을 그대로 둔다(순서 유지).
          atRule.replaceWith(atRule.nodes);
          return;
        }
        atRule.params = queries.join(", ");
      },
    },
  };
}
mobileOnlyMedia.postcss = true;
