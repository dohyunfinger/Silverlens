import { getGeminiConfig } from "../config/env";
import { loadKnowledgeData } from "../data/loadData";

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
  const knowledge = loadKnowledgeData();
  const prompt = [
    "당신은 시니어에게 식재료 정보를 쉬운 말로 설명하는 보조 AI입니다.",
    "의학적 진단이나 치료 지시를 하지 말고, 위험 가능성이 있으면 의료진 확인을 권하세요.",
    "등록된 알레르기 식품을 추천하지 마세요.",
    "답변은 짧은 문장과 짧은 문단을 사용한 한국어 Markdown으로 작성하세요.",
    "핵심 내용을 빠뜨리지 말고, 마지막 문장을 끝까지 완결해서 작성하세요.",
    "첨부된 글, 음성, 사진이 있으면 각각 따로 답하지 말고 하나의 질문으로 함께 이해하세요.",
    "사진이 있으면 사진 속 식재료를 확인하고, 음성이 있으면 말한 질문의 뜻을 반영하세요.",
    `사용자 나이대: ${profile.ageBand ?? "미입력"}대`,
    `알레르기: ${(profile.allergies ?? []).join(", ") || "미입력"}`,
    `질병 정보: ${(profile.conditions ?? []).join(", ") || "미입력"}`,
    `사투리 참고: ${JSON.stringify(knowledge.dialectTerms)}`,
    `식재료 별칭 참고: ${JSON.stringify(knowledge.foodAliases)}`,
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
