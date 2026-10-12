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

/** 한국어 기본 목소리: ElevenLabs Voice Library "Anna Kim - Tender, Calm and Clear". */
const DEFAULT_ELEVENLABS_VOICE_KO = "uyVNoMrnUku1dZyVEXwD";
/**
 * Voice Library 목소리는 유료 요금제에서만 API로 쓸 수 있다.
 * 무료 요금제에서는 ElevenLabs 기본 목소리 "Sarah - Mature, Reassuring"로 대신 읽는다.
 */
const DEFAULT_ELEVENLABS_FREE_VOICE_KO = "EXAVITQu4vr4xnSDxMaL";
const DEFAULT_ELEVENLABS_MODEL = "eleven_multilingual_v2";
/** 건강 안내라 매번 같은 톤으로, 과장 없이, 어르신이 듣기 편한 속도로 읽는다. */
const ELEVENLABS_VOICE_SETTINGS = {
  stability: 0.65,
  similarity_boost: 0.75,
  style: 0,
  speed: 0.9,
};

/**
 * ElevenLabs 나레이션 설정. 키가 없으면 null을 돌려 Gemini TTS만 쓴다.
 *
 * 한국어 목소리로 영어·일본어를 읽으면 한국어 억양이 섞이므로
 * 영어·일본어는 목소리 ID를 따로 지정했을 때만 ElevenLabs를 쓴다.
 * 언어마다 앞에서부터 시도할 목소리 목록을 돌려준다.
 */
export function getElevenLabsConfig() {
  const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
  if (!apiKey) return null;

  const voices: Record<string, Array<string | undefined>> = {
    "ko-KR": [
      process.env.ELEVENLABS_VOICE_ID_KO?.trim() || DEFAULT_ELEVENLABS_VOICE_KO,
      process.env.ELEVENLABS_FREE_VOICE_ID_KO?.trim() ||
        DEFAULT_ELEVENLABS_FREE_VOICE_KO,
    ],
    "en-US": [process.env.ELEVENLABS_VOICE_ID_EN?.trim()],
    "ja-JP": [process.env.ELEVENLABS_VOICE_ID_JA?.trim()],
  };

  return {
    apiKey,
    model: process.env.ELEVENLABS_MODEL?.trim() || DEFAULT_ELEVENLABS_MODEL,
    voiceSettings: ELEVENLABS_VOICE_SETTINGS,
    voicesFor: (language: string) => [
      ...new Set((voices[language] ?? []).filter((id): id is string => Boolean(id))),
    ],
  };
}

/**
 * 데이터 점검 화면(/log)과 그 API(/api/log)를 열어 둘지 판단한다.
 *
 * 이 화면은 어떤 모델을 쓰는지, API 키가 설정됐는지, 방언 서버 주소가 무엇인지를
 * 인증 없이 보여 준다. 그래서 개발 환경에서만 기본으로 열고, 배포 환경에서는
 * SILVERLENS_ENABLE_LOG=true 를 직접 설정해야 열리게 한다.
 *
 * 화면과 API가 서로 다른 기준으로 열리면 API는 404인데 화면은 뜨는 일이 생기므로
 * 두 곳이 이 함수 하나만 보게 한다.
 */
export function isDataLogEnabled() {
  return (
    process.env.NODE_ENV !== "production" ||
    process.env.SILVERLENS_ENABLE_LOG === "true"
  );
}
