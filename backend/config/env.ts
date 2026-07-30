const DEFAULT_TEXT_MODEL = "gemini-3.6-flash";
const DEFAULT_TTS_MODEL = "gemini-2.5-flash-preview-tts";
/**
 * 무료 한도가 더 넉넉한 모델을 예비로 둔다.
 * 앞 모델이 429(한도 초과)를 내면 순서대로 다음 모델로 넘어간다.
 */
const DEFAULT_TEXT_FALLBACKS = [
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
];
const DEFAULT_TTS_FALLBACKS = [
  "gemini-3.1-flash-tts-preview",
  "gemini-2.5-flash-preview-tts",
];

function parseModelList(raw: string | undefined) {
  return (raw ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

/** 앞에서부터 시도할 모델 목록. 중복은 제거하고 순서는 유지한다. */
function buildModelChain(primary: string, fallbacks: string[]) {
  return [...new Set([primary, ...fallbacks])];
}

export function getGeminiConfig() {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY가 설정되지 않았습니다.");
  }

  const textModel = process.env.GEMINI_TEXT_MODEL?.trim() || DEFAULT_TEXT_MODEL;
  const ttsModel = process.env.GEMINI_TTS_MODEL?.trim() || DEFAULT_TTS_MODEL;
  const textFallbacks = parseModelList(process.env.GEMINI_TEXT_FALLBACK_MODELS);
  const ttsFallbacks = parseModelList(process.env.GEMINI_TTS_FALLBACK_MODELS);

  return {
    apiKey,
    textModel,
    ttsModel,
    textModelChain: buildModelChain(
      textModel,
      textFallbacks.length > 0 ? textFallbacks : DEFAULT_TEXT_FALLBACKS,
    ),
    ttsModelChain: buildModelChain(
      ttsModel,
      ttsFallbacks.length > 0 ? ttsFallbacks : DEFAULT_TTS_FALLBACKS,
    ),
  };
}
