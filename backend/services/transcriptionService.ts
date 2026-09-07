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
  type HealthLanguage,
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
  /** 모델이 실제 음성에서 판단한 주 사용 언어. */
  detectedLanguage: HealthLanguage | "other" | "unclear";
  /** 중요한 단어가 불명확하거나 선택 언어와 다르면 답변으로 넘기지 않는다. */
  needsRetry: boolean;
};

/** 화면의 나이 버튼과 같은 구간만 받는다(frontend ageChoices 와 동일). */
const AGE_BANDS = [40, 50, 60, 70, 80, 90];

const transcriptLanguageRules: Record<HealthLanguage, string> = {
  "ko-KR":
    "한국어 음성으로 먼저 해석하고 transcript는 들리는 한국어를 한글로 그대로 받아쓰세요. 비슷하게 들리는 일본어·영어 단어로 바꾸거나 다른 언어로 번역하지 마세요.",
  "en-US":
    "Treat the recording as English first. Write transcript in English using the Latin alphabet exactly as spoken. Do not reinterpret similar sounds as Korean or Japanese, and do not translate them.",
  "ja-JP":
    "音声をまず日本語として認識してください。transcriptは、聞こえた日本語を漢字・ひらがな・カタカナでそのまま書き起こしてください。似た音の韓国語として解釈せず、韓国語や英語に翻訳したり、ローマ字で書いたりしないでください。",
};

const transcriptExamples: Record<HealthLanguage, string> = {
  "ko-KR": "복숭아 알레르기가 있어요.",
  "en-US": "I have a peach allergy.",
  "ja-JP": "桃アレルギーがあります。",
};

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

function cleanDetectedLanguage(
  value: unknown,
): HealthLanguage | "other" | "unclear" {
  if (value === "ko-KR" || value === "en-US" || value === "ja-JP") return value;
  return value === "other" ? "other" : "unclear";
}

function cleanConfidence(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.min(1, Math.max(0, parsed));
}

function cleanUncertainTerms(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(
    value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean),
  )].slice(0, 8);
}

/** 일본어·영어 설정인데 결과가 한글 위주면 번역·오인식된 결과로 보고 막는다. */
function usesWrongDominantScript(transcript: string, language: HealthLanguage) {
  const hangul = (transcript.match(/\p{Script=Hangul}/gu) ?? []).length;
  const japanese = (
    transcript.match(/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/gu) ?? []
  ).length;
  const latin = (transcript.match(/\p{Script=Latin}/gu) ?? []).length;

  if (language === "ja-JP") return hangul > Math.max(japanese, latin);
  if (language === "en-US") return hangul > Math.max(latin, japanese);
  // 한국어 문장 안의 원어 음식명·브랜드명은 해당 문자 그대로 둘 수 있다.
  return false;
}



function parseStructuredResult(
  text: string,
  selectedLanguage: HealthLanguage,
): TranscriptionResult {
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
    detectedLanguage?: unknown;
    confidence?: unknown;
    uncertainTerms?: unknown;
    needsRetry?: unknown;
  };
  const transcript =
    typeof parsed.transcript === "string" ? parsed.transcript.trim() : "";
  if (!transcript) throw new Error("음성에서 말을 찾지 못했습니다.");

  const detectedLanguage = cleanDetectedLanguage(parsed.detectedLanguage);
  const confidence = cleanConfidence(parsed.confidence);
  const uncertainTerms = cleanUncertainTerms(parsed.uncertainTerms);
  const detectedDifferentLanguage =
    detectedLanguage !== "other" &&
    detectedLanguage !== "unclear" &&
    detectedLanguage !== selectedLanguage;
  const needsRetry =
    parsed.needsRetry === true ||
    detectedLanguage === "unclear" ||
    detectedDifferentLanguage ||
    confidence < 0.8 ||
    uncertainTerms.length > 0 ||
    usesWrongDominantScript(transcript, selectedLanguage);

  return {
    transcript,
    allergies: cleanItems(parsed.allergies, "allergy"),
    conditions: cleanItems(parsed.conditions, "condition"),
    gender: cleanGender(parsed.gender),
    // 문장에서 직접 읽어 낸 나이를 먼저 쓰고, 없을 때만 모델이 준 값을 쓴다.
    ageBand:
      cleanAgeBand(extractAgeFromTranscript(transcript)) ??
      cleanAgeBand(parsed.age),
    detectedLanguage,
    needsRetry,
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
                  transcriptLanguageRules[selectedLanguage],
                  `받아쓰기 언어: ${selectedLanguage}`,
                  "transcript는 말한 내용을 원문 문자로 적고, 번역·의역·요약하지 마세요.",
                  "음성에서 실제로 들리지 않은 음식·식재료·제품 이름을 문맥으로 만들어 내지 마세요.",
                  "음식명처럼 답변의 의미를 바꾸는 단어가 조금이라도 불명확하면 추측하지 말고 uncertainTerms에 넣고 needsRetry를 true로 표시하세요.",
                  "선택 언어 문장 안에서 영어 브랜드명, 외국 음식명, 고유명사가 분명히 들리면 통상 사용하는 원래 표기를 유지하세요.",
                  "detectedLanguage는 번역된 transcript가 아니라 실제 음성의 주 사용 언어를 ko-KR, en-US, ja-JP, other, unclear 중 하나로 판단하세요.",
                  "confidence는 전체 문장과 핵심 음식명을 정확히 들었다는 확신을 0부터 1 사이 숫자로 적으세요.",
                  "음질이 나쁘거나 말이 겹치거나 핵심 단어가 불명확하면 confidence를 0.8 미만으로 적고 needsRetry를 true로 표시하세요.",
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
                  "참고 사전과 카탈로그는 건강정보 ID를 분류할 때만 사용하세요. transcript의 표현이나 언어를 한국어 표준 이름으로 바꾸지 마세요.",
                  "반드시 다음 JSON 객체만 반환하세요.",
                  `{"transcript":${JSON.stringify(transcriptExamples[selectedLanguage])},"allergies":["카탈로그 allergy ID"],"conditions":["카탈로그 condition ID"],"gender":"male|female|null","age":숫자 또는 null,"detectedLanguage":"${selectedLanguage}","confidence":0.99,"uncertainTerms":[],"needsRetry":false}`,
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
  return parseStructuredResult(generated, selectedLanguage);
}
