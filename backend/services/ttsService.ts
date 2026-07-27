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
  ttsModel: string,
  language: string,
) {
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
                  text: `${narrationInstruction(language)}\n${text}`,
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

export async function generateNarration(text: string, language = "ko-KR") {
  const { apiKey, ttsModel } = getGeminiConfig();
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) throw new Error("읽을 답변이 비어 있습니다.");
  return pcmToWav(
    await generateNarrationPcm(normalized, apiKey, ttsModel, language),
  );
}
