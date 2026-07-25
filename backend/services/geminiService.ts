import { getGeminiConfig } from "../config/env";
import { loadKnowledgeData } from "../data/loadData";

export type UserProfile = {
  language?: string;
  ageBand?: number;
  allergies?: string[];
  conditions?: string[];
};

type GeminiResponse = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
  error?: { message?: string };
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
) {
  const { apiKey, textModel } = getGeminiConfig();
  const knowledge = loadKnowledgeData();
  const prompt = [
    "당신은 시니어에게 식재료 정보를 쉬운 말로 설명하는 보조 AI입니다.",
    "의학적 진단이나 치료 지시를 하지 말고, 위험 가능성이 있으면 의료진 확인을 권하세요.",
    "등록된 알레르기 식품을 추천하지 마세요.",
    "답변은 짧은 문장과 목록을 사용한 한국어 Markdown으로 작성하세요.",
    "답변은 핵심 내용을 빠뜨리지 않되 1,500자 안에서 완결된 문장으로 끝내세요.",
    `사용자 나이대: ${profile.ageBand ?? "미입력"}대`,
    `알레르기: ${(profile.allergies ?? []).join(", ") || "미입력"}`,
    `질병 정보: ${(profile.conditions ?? []).join(", ") || "미입력"}`,
    `사투리 참고: ${JSON.stringify(knowledge.dialectTerms)}`,
    `식재료 별칭 참고: ${JSON.stringify(knowledge.foodAliases)}`,
    `안전 원칙: ${JSON.stringify(knowledge.safetyRules)}`,
    `사용자 질문: ${message}`,
  ].join("\n");

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(textModel)}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 4096 },
      }),
    },
  );
  const payload = (await response.json()) as GeminiResponse;
  if (!response.ok) {
    throw new Error(payload.error?.message || "Gemini API 호출에 실패했습니다.");
  }

  const candidate = payload.candidates?.[0];
  const answer = candidate?.content?.parts
    ?.map((part) => part.text || "")
    .join("")
    .trim();
  if (!answer) throw new Error("Gemini가 빈 답변을 반환했습니다.");
  if (candidate?.finishReason === "MAX_TOKENS") {
    throw new Error("Gemini 답변이 끝까지 생성되지 않았습니다. 질문을 다시 보내 주세요.");
  }
  return answer;
}
