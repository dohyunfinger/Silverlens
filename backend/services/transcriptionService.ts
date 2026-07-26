import { getGeminiConfig } from "../config/env";
import type { InlineMedia } from "./geminiService";

type GeminiResponse = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
  }>;
  error?: { message?: string };
};

export async function transcribeAudio(audio: InlineMedia) {
  const { apiKey, textModel } = getGeminiConfig();
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(textModel)}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              {
                text: [
                  "첨부한 음성에서 실제로 들리는 말만 받아쓰세요.",
                  "질문에 답하거나 내용을 요약하지 마세요.",
                  "한국어 발음과 식품명, 질병명, 알레르기명을 가능한 그대로 적으세요.",
                  "설명이나 따옴표 없이 받아쓴 문장만 반환하세요.",
                ].join("\n"),
              },
              {
                inline_data: {
                  data: audio.data,
                  mime_type: audio.mimeType,
                },
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 512,
        },
      }),
    },
  );
  const payload = (await response.json()) as GeminiResponse;
  if (!response.ok) {
    throw new Error(payload.error?.message || "Gemini 음성 인식에 실패했습니다.");
  }

  const transcript = payload.candidates?.[0]?.content?.parts
    ?.map((part) => part.text || "")
    .join("")
    .trim();
  if (!transcript) throw new Error("음성에서 말을 찾지 못했습니다.");
  return transcript;
}
