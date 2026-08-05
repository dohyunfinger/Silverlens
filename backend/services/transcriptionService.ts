import { getGeminiConfig } from "../config/env";
import { callGeminiGenerateContent } from "./geminiClient";
import { extractAgeFromTranscript } from "./koreanAge";
import {
  getDialectDictionaryForPrompt,
  getFoodAliasesForPrompt,
} from "../data/loadData";
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
  /** 말한 내용에 성별이 분명히 나올 때만 채운다. 아니면 null. */
  gender: "male" | "female" | null;
  /** 화면 버튼과 같은 나이대(40~90). 말하지 않았으면 null. */
  ageBand: number | null;
};

/** 화면의 나이 버튼과 같은 구간만 받는다(frontend ageChoices 와 동일). */
const AGE_BANDS = [40, 50, 60, 70, 80, 90];

function cleanItems(value: unknown, kind: HealthKind) {
  if (!Array.isArray(value)) return [];
  return [...new Set(
    value
      .filter((item): item is string => isHealthTermId(kind, item)),
  )];
}

function cleanGender(value: unknown): "male" | "female" | null {
  return value === "male" || value === "female" ? value : null;
}

/**
 * "예순", "60대", "63살" 같은 표현이 섞여 와도 화면 버튼 구간으로 맞춘다.
 * 40 미만은 40으로, 90 초과는 90으로 묶는다(버튼이 이하·이상 표기라서).
 */
function cleanAgeBand(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  const decade = Math.floor(parsed / 10) * 10;
  const clamped = Math.min(90, Math.max(40, decade));
  return AGE_BANDS.includes(clamped) ? clamped : null;
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
    gender?: unknown;
    age?: unknown;
  };
  const transcript =
    typeof parsed.transcript === "string" ? parsed.transcript.trim() : "";
  if (!transcript) throw new Error("음성에서 말을 찾지 못했습니다.");

  return {
    transcript,
    allergies: cleanItems(parsed.allergies, "allergy"),
    conditions: cleanItems(parsed.conditions, "condition"),
    gender: cleanGender(parsed.gender),
    // 문장에서 직접 읽어 낸 나이를 먼저 쓰고, 없을 때만 모델이 준 값을 쓴다.
    ageBand:
      cleanAgeBand(extractAgeFromTranscript(transcript)) ??
      cleanAgeBand(parsed.age),
  };
}

export async function transcribeAudio(
  audio: InlineMedia,
  purpose: TranscriptionPurpose = "chat",
  language = "ko-KR",
) {
  const { apiKey, textModelChain } = getGeminiConfig();
  const dialectDictionary = getDialectDictionaryForPrompt();
  const foodAliases = getFoodAliasesForPrompt();
  const healthCatalog = getHealthCatalogForPrompt();
  const selectedLanguage = toHealthLanguage(language);
  const { rawBody } = await callGeminiGenerateContent({
    apiKey,
    models: textModelChain,
    language: selectedLanguage,
    defaultErrorMessage: "Gemini 음성 인식에 실패했습니다.",
    body: {
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
                  "conditions에는 사용자가 직접 말한 질병이나 관리 중인 건강 상태(예: 폐경 후)만 넣으세요.",
                  "질병 이름을 알레르기에 넣거나, 알레르기 음식을 질병에 넣지 마세요.",
                  '예: "복숭아 알레르기가 있고 알츠하이머가 있어요" → allergies ["allergy_peach"], conditions ["condition_alzheimers"].',
                  "폐경은 질병으로 단정하지 말고, 사용자가 폐경·완경·갱년기라고 직접 밝힌 경우에만 건강 상태로 분류하세요.",
                  "말하지 않은 건강정보를 추측해서 추가하지 마세요.",
                  "카탈로그에 없는 항목은 배열에 임의로 추가하지 마세요.",
                  // 성별·나이는 화면의 선택 버튼을 자동으로 눌러 주는 데 쓴다.
                  '성별을 직접 말한 경우에만 gender 에 "male" 또는 "female" 을 넣고, 말하지 않았으면 null 을 넣으세요.',
                  "목소리 톤이나 이름으로 성별을 추측하지 마세요. 말로 밝힌 경우에만 넣으세요.",
                  "나이를 말한 경우에만 age 에 숫자만 넣고, 말하지 않았으면 null 을 넣으세요.",
                  '"60대", "63살" 처럼 말하면 age 에 숫자로 적으세요(예: 60, 63).',
                  // 우리말 수사를 한 칸씩 밀려 옮기는 일이 실제로 있어 표를 그대로 준다.
                  "우리말 나이는 다음 표 그대로 옮기세요. 서른=30, 마흔=40, 쉰=50, 예순=60, 일흔=70, 여든=80, 아흔=90.",
                  "한자말 나이도 다음 표 그대로 옮기세요. 삼십=30, 사십=40, 오십=50, 육십=60, 칠십=70, 팔십=80, 구십=90.",
                  '예: "나이는 일흔이고" → age 70. "예순다섯입니다" → age 65.',
                  "표에 없는 값으로 바꾸거나 한 단계 올리거나 내리지 마세요.",
                  "나이를 짐작해서 넣지 마세요.",
                  `현재 입력 화면: ${purpose}`,
                  `화면 표시 언어: ${selectedLanguage}`,
                  `건강정보 다국어 카탈로그: ${JSON.stringify(healthCatalog)}`,
                  `방언 참고 사전: ${JSON.stringify(dialectDictionary)}`,
                  `외래어·별칭 참고 사전: ${JSON.stringify(foodAliases)}`,
                  "방언이나 외래어로 들리는 식품명은 참고 사전의 표준 이름으로 바꿔 적으세요.",
                  "반드시 다음 JSON 객체만 반환하세요.",
                  '{"transcript":"받아쓴 전체 문장","allergies":["카탈로그 allergy ID"],"conditions":["카탈로그 condition ID"],"gender":"male|female|null","age":숫자 또는 null}',
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
    },
  });
  const payload = JSON.parse(rawBody) as GeminiResponse;

  const generated = payload.candidates?.[0]?.content?.parts
    ?.map((part) => part.text || "")
    .join("")
    .trim();
  if (!generated) throw new Error("음성에서 말을 찾지 못했습니다.");
  return parseStructuredResult(generated);
}
