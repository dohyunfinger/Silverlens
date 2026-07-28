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

function pcmToWav(pcm: Uint8Array, sampleRate = 24000) {
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

export async function generateNarration(text: string, language = "ko-KR") {
  const { apiKey, ttsModelChain } = getGeminiConfig();
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) throw new Error("읽을 답변이 비어 있습니다.");
  const { pcm, sampleRate } = await generateNarrationPcm(
    normalized,
    apiKey,
    ttsModelChain,
    language,
  );
  return pcmToWav(pcm, sampleRate);
}
