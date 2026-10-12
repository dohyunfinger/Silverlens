import { getElevenLabsConfig, getGeminiConfig } from "../config/env";
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

/** ElevenLabs가 언어 코드를 ISO 639-1로 받는다. */
function elevenLabsLanguageCode(language: string) {
  return language.split("-")[0]?.toLowerCase() || "ko";
}

/**
 * 요금제·키 권한 문제는 다시 시도해도 같은 결과라 잠시 건너뛴다.
 * 매 요청마다 실패 왕복을 하지 않기 위함.
 * - 402(유료 목소리): 그 목소리만 막고 다음 목소리로 넘어간다.
 * - 401/403(키 문제): ElevenLabs 전체를 막고 Gemini로 간다.
 */
const ELEVENLABS_BLOCK_MS = 10 * 60 * 1000;
const ALL_VOICES = "*";
const elevenLabsBlockedUntil = new Map<string, number>();

function isElevenLabsBlocked(voiceId: string) {
  const now = Date.now();
  return [ALL_VOICES, voiceId].some(
    (key) => (elevenLabsBlockedUntil.get(key) ?? 0) > now,
  );
}

async function generateElevenLabsMp3(
  text: string,
  config: NonNullable<ReturnType<typeof getElevenLabsConfig>>,
  voiceId: string,
  language: string,
) {
  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: {
        "xi-api-key": config.apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: config.model,
        language_code: elevenLabsLanguageCode(language),
        voice_settings: config.voiceSettings,
      }),
    },
  );
  if (!response.ok) {
    if (response.status === 402) {
      elevenLabsBlockedUntil.set(voiceId, Date.now() + ELEVENLABS_BLOCK_MS);
    } else if (response.status === 401 || response.status === 403) {
      elevenLabsBlockedUntil.set(ALL_VOICES, Date.now() + ELEVENLABS_BLOCK_MS);
    }
    const detail = await response.text().catch(() => "");
    throw new Error(`ElevenLabs TTS 실패 (${response.status}): ${detail.slice(0, 200)}`);
  }
  const audio = new Uint8Array(await response.arrayBuffer());
  if (audio.byteLength === 0) throw new Error("ElevenLabs TTS가 빈 음성을 반환했습니다.");
  return audio;
}

/**
 * 같은 문장을 다시 읽어 달라는 요청이 잦다.
 * 안내 문구, 답변 다시 듣기, 언어 전환이 대표적이다. 생성에 5~20초가 걸리므로
 * 만들어 둔 음성을 잠시 보관해 두면 두 번째부터는 즉시 응답한다.
 */
const NARRATION_CACHE_TTL_MS = 30 * 60 * 1000;
const NARRATION_CACHE_MAX_BYTES = 20 * 1024 * 1024;

/** Response 본문으로 그대로 넘길 수 있도록 ArrayBuffer 기반 뷰로 고정한다. */
export type NarrationAudio = {
  audio: Uint8Array<ArrayBuffer>;
  /** ElevenLabs는 audio/mpeg, Gemini는 audio/wav. */
  contentType: string;
};

const narrationCache = new Map<string, { savedAt: number; narration: NarrationAudio }>();
let narrationCacheBytes = 0;

function readNarrationCache(key: string) {
  const hit = narrationCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.savedAt > NARRATION_CACHE_TTL_MS) {
    narrationCache.delete(key);
    narrationCacheBytes -= hit.narration.audio.byteLength;
    return null;
  }
  // 최근에 쓴 항목을 뒤로 보내 가장 오래된 것부터 지워지게 한다.
  narrationCache.delete(key);
  narrationCache.set(key, hit);
  return hit.narration;
}

function writeNarrationCache(key: string, narration: NarrationAudio) {
  const size = narration.audio.byteLength;
  if (size > NARRATION_CACHE_MAX_BYTES) return;
  narrationCache.set(key, { savedAt: Date.now(), narration });
  narrationCacheBytes += size;

  while (narrationCacheBytes > NARRATION_CACHE_MAX_BYTES) {
    const oldestKey = narrationCache.keys().next().value;
    if (oldestKey === undefined) break;
    const oldest = narrationCache.get(oldestKey);
    narrationCache.delete(oldestKey);
    narrationCacheBytes -= oldest?.narration.audio.byteLength ?? 0;
  }
}

export function getNarrationCacheStats() {
  return {
    entries: narrationCache.size,
    bytes: narrationCacheBytes,
    elevenLabsBlocked: Object.fromEntries(
      [...elevenLabsBlockedUntil]
        .filter(([, until]) => until > Date.now())
        .map(([voiceId, until]) => [voiceId, new Date(until).toISOString()]),
    ),
  };
}

export async function generateNarration(
  text: string,
  language = "ko-KR",
): Promise<NarrationAudio> {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) throw new Error("읽을 답변이 비어 있습니다.");

  const cacheKey = `${language}\u0000${normalized}`;
  const cached = readNarrationCache(cacheKey);
  if (cached) return cached;

  const elevenLabs = getElevenLabsConfig();
  for (const voiceId of elevenLabs?.voicesFor(language) ?? []) {
    if (!elevenLabs || isElevenLabsBlocked(voiceId)) continue;
    try {
      const narration: NarrationAudio = {
        audio: await generateElevenLabsMp3(normalized, elevenLabs, voiceId, language),
        contentType: "audio/mpeg",
      };
      writeNarrationCache(cacheKey, narration);
      return narration;
    } catch (error) {
      // 음성이 아예 안 나오는 것보다 다음 목소리나 Gemini로라도 읽어 주는 편이 낫다.
      console.warn(`[SilverLens] ElevenLabs 목소리 ${voiceId} 실패, 다음 경로로 대체:`, error);
    }
  }

  const { apiKey, ttsModelChain } = getGeminiConfig();
  const { pcm, sampleRate } = await generateNarrationPcm(
    normalized,
    apiKey,
    ttsModelChain,
    language,
  );
  const narration: NarrationAudio = {
    audio: pcmToWav(pcm, sampleRate),
    contentType: "audio/wav",
  };
  writeNarrationCache(cacheKey, narration);
  return narration;
}
