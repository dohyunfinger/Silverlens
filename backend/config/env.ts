export function getGeminiConfig() {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY가 설정되지 않았습니다.");
  }

  const textModel =
    process.env.GEMINI_TEXT_MODEL?.trim() || "gemini-3.6-flash";

  return {
    apiKey,
    textModel,
    ttsModel:
      process.env.GEMINI_TTS_MODEL?.trim() || "gemini-2.5-flash-preview-tts",
  };
}
