import tailwindcss from "@tailwindcss/postcss";
import mobileOnlyMedia from "./build/mobile-only-media.mjs";

const config = {
  // 휴대폰 화면 하나로 통일한다(build/mobile-only-media.mjs 참고). 빼면 예전 PC 화면으로 돌아간다.
  plugins: [mobileOnlyMedia(), tailwindcss()],
};

export default config;
