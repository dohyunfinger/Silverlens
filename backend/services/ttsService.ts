import { getGeminiConfig } from "../config/env";
import { callGeminiGenerateContent } from "./geminiClient";

type TtsPayload = {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        inlineData?: { data?: string; mimeType?: string };
      }>;
    };
  }>;
  error?: { message?: string };
};

function pcmToWav(pcm: Uint8Array, sampleRate = 24000): Uint8Array<ArrayBuffer> {
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  const write = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };
  write(0, "RIFF");
  view.setUint32(4, 36 + pcm.byteLength, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, pcm.byteLength, true);
  const wav = new Uint8Array(44 + pcm.byteLength);
  wav.set(new Uint8Array(header), 0);
  wav.set(pcm, 44);
  return wav;
}

/**
 * Gemini는 "audio/L16;codec=pcm;rate=24000" 형태로 샘플레이트를 알려준다.
 * 헤더에 실제와 다른 값을 쓰면 재생 속도와 음높이가 어긋나므로 응답 값을 그대로 쓴다.
 */
function parseSampleRate(mimeType?: string) {
  const matched = /rate=(\d+)/i.exec(mimeType ?? "");
  const parsed = matched ? Number(matched[1]) : NaN;
  return Number.isFinite(parsed) && parsed >= 8000 && parsed <= 48000
    ? parsed
    : 24000;
}

function narrationInstruction(language: string) {
  if (language === "en-US") {
    return "Read the following text exactly as written, clearly, warmly, and at a comfortable pace for an older listener:";
  }
  if (language === "ja-JP") {
    return "次の文章を、年配の方が聞き取りやすいように、はっきり、やさしく、落ち着いた速さでそのまま読んでください：";
  }
  return "어르신께 또박또박하고 따뜻하게 다음 문장을 그대로 읽어주세요:";
}

async function generateNarrationPcm(
  text: string,
  apiKey: string,
  ttsModels: string[],
  language: string,
) {
  const { rawBody } = await callGeminiGenerateContent({
    apiKey,
    models: ttsModels,
    language,
    defaultErrorMessage: "Gemini TTS 호출에 실패했습니다.",
    body: {
      contents: [
        {
          parts: [{ text: `${narrationInstruction(language)}\n${text}` }],
        },
      ],
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } },
        },
      },
    },
  });

  const payload = JSON.parse(rawBody) as TtsPayload;
  const inlineParts =
    payload.candidates?.[0]?.content?.parts
      ?.map((part) => part.inlineData)
      .filter(
        (inlineData): inlineData is { data: string; mimeType?: string } =>
          Boolean(inlineData?.data),
      ) ?? [];
  if (inlineParts.length === 0) {
    throw new Error("Gemini TTS가 빈 음성을 반환했습니다.");
  }

  const audioParts = inlineParts.map((inlineData) =>
    Uint8Array.from(atob(inlineData.data), (value) => value.charCodeAt(0)),
  );
  const sampleRate = parseSampleRate(inlineParts[0]?.mimeType);
  const byteLength = audioParts.reduce(
    (total, chunk) => total + chunk.byteLength,
    0,
  );
  const combined = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of audioParts) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { pcm: combined, sampleRate };
}

/**
 * 같은 문장을 다시 읽어 달라는 요청이 잦다.
 * 안내 문구, 답변 다시 듣기, 언어 전환이 대표적이다. 생성에 5~20초가 걸리므로
 * 만들어 둔 WAV를 잠시 보관해 두면 두 번째부터는 즉시 응답한다.
 */
const NARRATION_CACHE_TTL_MS = 30 * 60 * 1000;
const NARRATION_CACHE_MAX_BYTES = 20 * 1024 * 1024;

/** Response 본문으로 그대로 넘길 수 있도록 ArrayBuffer 기반 뷰로 고정한다. */
type NarrationWav = Uint8Array<ArrayBuffer>;

const narrationCache = new Map<string, { savedAt: number; wav: NarrationWav }>();
let narrationCacheBytes = 0;

function readNarrationCache(key: string) {
  const hit = narrationCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.savedAt > NARRATION_CACHE_TTL_MS) {
    narrationCache.delete(key);
    narrationCacheBytes -= hit.wav.byteLength;
    return null;
  }
  // 최근에 쓴 항목을 뒤로 보내 가장 오래된 것부터 지워지게 한다.
  narrationCache.delete(key);
  narrationCache.set(key, hit);
  return hit.wav;
}

function writeNarrationCache(key: string, wav: NarrationWav) {
  if (wav.byteLength > NARRATION_CACHE_MAX_BYTES) return;
  narrationCache.set(key, { savedAt: Date.now(), wav });
  narrationCacheBytes += wav.byteLength;

  while (narrationCacheBytes > NARRATION_CACHE_MAX_BYTES) {
    const oldestKey = narrationCache.keys().next().value;
    if (oldestKey === undefined) break;
    const oldest = narrationCache.get(oldestKey);
    narrationCache.delete(oldestKey);
    narrationCacheBytes -= oldest?.wav.byteLength ?? 0;
  }
}

export function getNarrationCacheStats() {
  return {
    entries: narrationCache.size,
    bytes: narrationCacheBytes,
  };
}

export async function generateNarration(text: string, language = "ko-KR") {
  const { apiKey, ttsModelChain } = getGeminiConfig();
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) throw new Error("읽을 답변이 비어 있습니다.");

  const cacheKey = `${language}\u0000${normalized}`;
  const cached = readNarrationCache(cacheKey);
  if (cached) return cached;

  const { pcm, sampleRate } = await generateNarrationPcm(
    normalized,
    apiKey,
    ttsModelChain,
    language,
  );
  const wav = pcmToWav(pcm, sampleRate);
  writeNarrationCache(cacheKey, wav);
  return wav;
}
