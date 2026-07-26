import { getGeminiConfig } from "../config/env";
import { findRelevantKnowledge } from "../data/loadData";

export type UserProfile = {
  language?: string;
  ageBand?: number;
  allergies?: string[];
  conditions?: string[];
};

export type InlineMedia = {
  data: string;
  mimeType: string;
};

type GeminiResponse = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
  error?: { message?: string };
};

type GeminiPart =
  | { text: string }
  | { inline_data: { data: string; mime_type: string } };

type GeminiContent = {
  role: "user" | "model";
  parts: GeminiPart[];
};

export function isMeaningfulText(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    /[\p{L}\p{N}]/u.test(value)
  );
}

export async function generateSeniorFriendlyAnswer(
  message: string,
  profile: UserProfile = {},
  media: { audio?: InlineMedia | null; image?: InlineMedia | null } = {},
) {
  const { apiKey, textModel } = getGeminiConfig();
  const knowledge = findRelevantKnowledge(message, profile);
  const prompt = [
    "당신은 시니어에게 식재료 정보를 쉬운 말로 설명하는 보조 AI입니다.",
    "의학적 진단이나 치료 지시를 하지 말고, 위험 가능성이 있으면 의료진 확인을 권하세요.",
    "등록된 알레르기 식품을 추천하지 마세요.",
    "첫 문장에서 결론을 말하고, 꼭 필요한 내용만 보통 6~9문장 이내로 설명하세요.",
    "문장 하나에는 핵심 하나만 담고, 한 문단은 1~2개의 짧은 문장으로 작성하세요.",
    "TTS로 자연스럽게 읽히도록 표와 긴 목록은 피하고, 문장 사이를 짧은 문단으로 나누세요.",
    "핵심 내용을 빠뜨리지 말고, 마지막 문장을 끝까지 완결해서 작성하세요.",
    "첨부된 글, 음성, 사진이 있으면 각각 따로 답하지 말고 하나의 질문으로 함께 이해하세요.",
    "사진이 있으면 사진 속 식재료를 확인하고, 음성이 있으면 말한 질문의 뜻을 반영하세요.",
    "사용자 질문에 방언이 있으면 방언 참고 자료를 이용해 표준어 의미로 이해하세요.",
    "아래 식품 자료는 답변 후보를 찾기 위한 내부 참고 자료입니다.",
    "자료에 있는 건강 효능·권장량 문구를 검증된 의학 사실처럼 단정하지 마세요.",
    "사용자 알레르기나 질병 정보와 충돌하거나 불확실하면 안전 원칙을 우선하세요.",
    `사용자 나이대: ${profile.ageBand ?? "미입력"}대`,
    `알레르기: ${(profile.allergies ?? []).join(", ") || "미입력"}`,
    `질병 정보: ${(profile.conditions ?? []).join(", ") || "미입력"}`,
    `질문에서 찾은 방언 참고: ${JSON.stringify(knowledge.dialectHints)}`,
    `기존 방언 참고: ${JSON.stringify(knowledge.legacyDialectTerms)}`,
    `식재료 별칭 참고: ${JSON.stringify(knowledge.foodAliases)}`,
    `관련 요리·재료 자료: ${JSON.stringify(knowledge.recipes)}`,
    `관련 시니어 식품 자료: ${JSON.stringify(knowledge.foods)}`,
    `안전 원칙: ${JSON.stringify(knowledge.safetyRules)}`,
    `사용자 글 질문: ${message || "없음. 첨부된 음성이나 사진을 중심으로 답변할 것"}`,
  ].join("\n");

  const firstQuestion: GeminiContent = { role: "user", parts: [{ text: prompt }] };
  if (media.image) {
    firstQuestion.parts.push({
      inline_data: {
        data: media.image.data,
        mime_type: media.image.mimeType,
      },
    });
  }
  if (media.audio) {
    firstQuestion.parts.push({
      inline_data: {
        data: media.audio.data,
        mime_type: media.audio.mimeType,
      },
    });
  }
  let contents: GeminiContent[] = [firstQuestion];
  let completeAnswer = "";

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(textModel)}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          contents,
          generationConfig: { temperature: 0.2, maxOutputTokens: 8192 },
        }),
      },
    );
    const payload = (await response.json()) as GeminiResponse;
    if (!response.ok) {
      throw new Error(payload.error?.message || "Gemini API 호출에 실패했습니다.");
    }

    const candidate = payload.candidates?.[0];
    const generated = candidate?.content?.parts
      ?.map((part) => part.text || "")
      .join("")
      .trim();
    if (!generated) throw new Error("Gemini가 빈 답변을 반환했습니다.");

    completeAnswer = `${completeAnswer}${completeAnswer ? "\n\n" : ""}${generated}`;
    if (candidate?.finishReason !== "MAX_TOKENS") {
      return completeAnswer;
    }

    contents = [
      firstQuestion,
      { role: "model", parts: [{ text: completeAnswer }] },
      {
        role: "user",
        parts: [
          {
            text: "앞 내용과 중복하지 말고 끊긴 지점부터 이어서, 남은 설명을 완전한 문장으로 마무리해 주세요.",
          },
        ],
      },
    ];
  }

  return completeAnswer;
}
