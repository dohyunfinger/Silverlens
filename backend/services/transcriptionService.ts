import { getGeminiConfig } from "../config/env";
import { getDialectDictionaryForPrompt } from "../data/loadData";
import {
  getHealthCatalogForPrompt,
  isHealthTermId,
  toHealthLanguage,
  type HealthKind,
} from "../data/healthTerms";
import type { InlineMedia } from "./geminiService";

type GeminiResponse = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
  }>;
  error?: { message?: string };
};

export type TranscriptionPurpose =
  | "chat"
  | "setup"
  | "allergy"
  | "condition";

export type TranscriptionResult = {
  transcript: string;
  allergies: string[];
  conditions: string[];
};

function cleanItems(value: unknown, kind: HealthKind) {
  if (!Array.isArray(value)) return [];
  return [...new Set(
    value
      .filter((item): item is string => isHealthTermId(kind, item)),
  )];
}

function parseStructuredResult(text: string): TranscriptionResult {
  const withoutFence = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const objectStart = withoutFence.indexOf("{");
  const objectEnd = withoutFence.lastIndexOf("}");
  if (objectStart < 0 || objectEnd <= objectStart) {
    throw new Error("음성 분류 결과의 형식이 올바르지 않습니다.");
  }

  const parsed = JSON.parse(
    withoutFence.slice(objectStart, objectEnd + 1),
  ) as {
    transcript?: unknown;
    allergies?: unknown;
    conditions?: unknown;
  };
  const transcript =
    typeof parsed.transcript === "string" ? parsed.transcript.trim() : "";
  if (!transcript) throw new Error("음성에서 말을 찾지 못했습니다.");

  return {
    transcript,
    allergies: cleanItems(parsed.allergies, "allergy"),
    conditions: cleanItems(parsed.conditions, "condition"),
  };
}

export async function transcribeAudio(
  audio: InlineMedia,
  purpose: TranscriptionPurpose = "chat",
  language = "ko-KR",
) {
  const { apiKey, textModel } = getGeminiConfig();
  const dialectDictionary = getDialectDictionaryForPrompt();
  const healthCatalog = getHealthCatalogForPrompt();
  const selectedLanguage = toHealthLanguage(language);
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
                  "첨부한 음성에서 실제로 들리는 말을 받아쓰고 건강정보를 분류하세요.",
                  "질문에 답하거나 내용을 요약하지 마세요.",
                  "식품명, 질병명, 알레르기명을 가능한 정확히 적으세요.",
                  "알레르기에는 사용자가 알레르기라고 명시한 음식·물질만 넣으세요.",
                  "질병에는 사용자가 진단·치료·보유 중이라고 말한 질병이나 질환만 넣으세요.",
                  "질병 이름을 알레르기에 넣거나, 알레르기 음식을 질병에 넣지 마세요.",
                  '예: "복숭아 알레르기가 있고 알츠하이머가 있어요" → allergies ["allergy_peach"], conditions ["condition_alzheimers"].',
                  "말하지 않은 건강정보를 추측해서 추가하지 마세요.",
                  "카탈로그에 없는 항목은 배열에 임의로 추가하지 마세요.",
                  `현재 입력 화면: ${purpose}`,
                  `화면 표시 언어: ${selectedLanguage}`,
                  `건강정보 다국어 카탈로그: ${JSON.stringify(healthCatalog)}`,
                  `방언 참고 사전: ${JSON.stringify(dialectDictionary)}`,
                  "반드시 다음 JSON 객체만 반환하세요.",
                  '{"transcript":"받아쓴 전체 문장","allergies":["카탈로그 allergy ID"],"conditions":["카탈로그 condition ID"]}',
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
          maxOutputTokens: 1024,
          responseMimeType: "application/json",
        },
      }),
    },
  );
  const payload = (await response.json()) as GeminiResponse;
  if (!response.ok) {
    throw new Error(payload.error?.message || "Gemini 음성 인식에 실패했습니다.");
  }

  const generated = payload.candidates?.[0]?.content?.parts
    ?.map((part) => part.text || "")
    .join("")
    .trim();
  if (!generated) throw new Error("음성에서 말을 찾지 못했습니다.");
  return parseStructuredResult(generated);
}
