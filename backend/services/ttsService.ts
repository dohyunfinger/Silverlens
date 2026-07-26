import { getGeminiConfig } from "../config/env";

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

function splitText(text: string, maxChars = 420) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return [];
  const sentences =
    normalized.match(/[^.!?。！？]+(?:[.!?。！？]+|$)/g)?.map((item) => item.trim()) ??
    [normalized];
  const chunks: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    const parts =
      sentence.length <= maxChars
        ? [sentence]
        : sentence.match(new RegExp(`.{1,${maxChars}}`, "g")) ?? [sentence];
    for (const part of parts) {
      const candidate = current ? `${current} ${part}` : part;
      if (candidate.length > maxChars && current) {
        chunks.push(current);
        current = part;
      } else {
        current = candidate;
      }
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

async function generateNarrationPcm(text: string, apiKey: string, ttsModel: string) {
  let lastError = "Gemini TTS 호출에 실패했습니다.";

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(ttsModel)}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: `어르신께 또박또박하고 따뜻하게 다음 문장을 그대로 읽어주세요:\n${text}`,
                },
              ],
            },
          ],
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: {
              voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } },
            },
          },
        }),
      },
    );
    const payload = (await response.json()) as TtsPayload;
    if (!response.ok) {
      lastError = payload.error?.message || "Gemini TTS 호출에 실패했습니다.";
      if (
        attempt === 0 &&
        (response.status === 429 || response.status >= 500)
      ) {
        await new Promise((resolve) => setTimeout(resolve, 450));
        continue;
      }
      throw new Error(lastError);
    }

    const audioParts =
      payload.candidates?.[0]?.content?.parts
        ?.map((part) => part.inlineData?.data)
        .filter((data): data is string => Boolean(data))
        .map((data) =>
          Uint8Array.from(atob(data), (value) => value.charCodeAt(0)),
        ) ?? [];
    if (audioParts.length === 0) {
      lastError = "Gemini TTS가 빈 음성을 반환했습니다.";
      if (attempt === 0) {
        await new Promise((resolve) => setTimeout(resolve, 450));
        continue;
      }
      throw new Error(lastError);
    }

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
    return combined;
  }

  throw new Error(lastError);
}

export async function generateNarration(text: string) {
  const { apiKey, ttsModel } = getGeminiConfig();
  const chunks = splitText(text);
  if (chunks.length === 0) throw new Error("읽을 답변이 비어 있습니다.");

  const pcmChunks: Uint8Array[] = [];
  const silence = new Uint8Array(Math.round(24000 * 2 * 0.12));
  for (let index = 0; index < chunks.length; index += 1) {
    pcmChunks.push(await generateNarrationPcm(chunks[index], apiKey, ttsModel));
    if (index < chunks.length - 1) pcmChunks.push(silence);
  }

  const byteLength = pcmChunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  const combined = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of pcmChunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return pcmToWav(combined);
}
