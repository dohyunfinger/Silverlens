import { getGeminiConfig } from "../config/env";
import { findRelevantKnowledge } from "../data/loadData";
import {
  findAllergyTermConflicts,
  getHealthLabel,
  toHealthLanguage,
} from "../data/healthTerms";

export type RiskLevel = "danger" | "caution" | "safe";

export type ConversationTurn = {
  question: string;
  answer: string;
};

export type UserProfile = {
  language?: string;
  ageBand?: number;
  allergies?: string[];
  conditions?: string[];
  allergyIds?: string[];
  conditionIds?: string[];
};

export type InlineMedia = {
  data: string;
  mimeType: string;
};

export type SeniorAnswerResult = {
  answer: string;
  riskLevel: RiskLevel;
  warningMessage: string;
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
  role: "user";
  parts: GeminiPart[];
};

type StructuredAnswer = {
  answer?: unknown;
  risk_level?: unknown;
  warning_message?: unknown;
};

export function isMeaningfulText(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    /[\p{L}\p{N}]/u.test(value)
  );
}

function stripJsonFence(text: string) {
  return text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function parseStructuredAnswer(text: string): SeniorAnswerResult {
  const cleaned = stripJsonFence(text);
  const objectStart = cleaned.indexOf("{");
  const objectEnd = cleaned.lastIndexOf("}");
  if (objectStart < 0 || objectEnd <= objectStart) {
    throw new Error("Gemini 답변 형식이 올바르지 않습니다.");
  }

  const parsed = JSON.parse(
    cleaned.slice(objectStart, objectEnd + 1),
  ) as StructuredAnswer;
  if (!isMeaningfulText(parsed.answer)) {
    throw new Error("Gemini가 빈 답변을 반환했습니다.");
  }

  const riskLevel: RiskLevel =
    parsed.risk_level === "danger" ||
    parsed.risk_level === "caution" ||
    parsed.risk_level === "safe"
      ? parsed.risk_level
      : "caution";
  return {
    answer: parsed.answer.trim(),
    riskLevel,
    warningMessage:
      riskLevel !== "safe" && typeof parsed.warning_message === "string"
        ? parsed.warning_message.trim()
        : "",
  };
}

function answerLanguageInstruction(language?: string) {
  if (language === "en-US") {
    return "Write the entire answer and warning message in English.";
  }
  if (language === "zh-CN") {
    return "请使用简体中文写出完整回答和警告信息。";
  }
  return "답변과 경고 문구 전체를 한국어로 작성하세요.";
}

function localizedAllergyWarning(language: string | undefined, labels: string[]) {
  const joined = labels.join(", ");
  if (language === "en-US") {
    return `Warning: ${joined} matches the user's registered allergy information. Do not use or consume it.`;
  }
  if (language === "zh-CN") {
    return `警告：${joined}与已登记的过敏信息相符，请勿使用或食用。`;
  }
  return `경고: ${joined}은(는) 등록된 알레르기 식품과 일치하므로 사용하거나 섭취하지 마세요.`;
}

function localizedGeneralWarning(language?: string) {
  if (language === "en-US") {
    return "Caution: This food may not be recommended for the user's current profile. Check the explanation before eating it.";
  }
  if (language === "zh-CN") {
    return "注意：根据当前健康信息，可能不建议食用此食物。食用前请先查看说明。";
  }
  return "주의: 현재 건강정보를 기준으로 권장하지 않거나 확인이 필요한 음식입니다. 섭취 전 설명을 확인하세요.";
}

function normalizedRiskText(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[\s'’"“”.,/#!$%^&*;:{}=_`~()]+/g, "");
}

function sanitizeHistory(history: ConversationTurn[]) {
  return history
    .filter(
      (turn) =>
        isMeaningfulText(turn.question) &&
        isMeaningfulText(turn.answer),
    )
    .slice(-6)
    .map((turn) => ({
      question: turn.question.trim().slice(0, 1000),
      answer: turn.answer.trim().slice(0, 2200),
    }));
}

export async function generateSeniorFriendlyAnswer(
  message: string,
  profile: UserProfile = {},
  media: { audio?: InlineMedia | null; image?: InlineMedia | null } = {},
  history: ConversationTurn[] = [],
): Promise<SeniorAnswerResult> {
  const { apiKey, textModel } = getGeminiConfig();
  const conversationHistory = sanitizeHistory(history);
  const topicContext = [
    ...conversationHistory.slice(-3).map((turn) => turn.question),
    message,
  ]
    .filter(Boolean)
    .join("\n");
  const knowledge = findRelevantKnowledge(topicContext);
  const selectedLanguage = toHealthLanguage(profile.language);
  const profileAllergies =
    profile.allergies ??
    (profile.allergyIds ?? []).map((id) => getHealthLabel(id, selectedLanguage));
  const profileConditions =
    profile.conditions ??
    (profile.conditionIds ?? []).map((id) => getHealthLabel(id, selectedLanguage));
  const allergyConflicts = findAllergyTermConflicts(
    topicContext,
    profile.allergyIds ?? [],
  );
  const normalizedTopicContext = normalizedRiskText(topicContext);
  const directProfileAllergyLabels = profileAllergies.filter((label) => {
    const normalizedLabel = normalizedRiskText(label);
    return normalizedLabel.length >= 2 && normalizedTopicContext.includes(normalizedLabel);
  });
  const allergyConflictLabels = [...new Set([
    ...allergyConflicts.map((term) =>
      getHealthLabel(term.id, selectedLanguage),
    ),
    ...directProfileAllergyLabels,
  ])];

  const prompt = [
    "당신은 시니어에게 식재료와 조리 정보를 쉬운 말로 설명하는 보조 AI입니다.",
    answerLanguageInstruction(selectedLanguage),
    "의학적 진단이나 치료 지시를 하지 말고, 위험 가능성이 있으면 의료진 또는 약사 확인을 권하세요.",
    "등록된 알레르기 식품을 추천하거나 레시피 재료로 넣지 마세요.",
    "첫 문장에서 결론을 말하고, 꼭 필요한 내용만 보통 6~9개의 짧은 문장으로 설명하세요.",
    "문장 하나에는 핵심 하나만 담고, 한 문단은 1~2개의 짧은 문장으로 작성하세요.",
    "TTS로 자연스럽게 읽히도록 표와 긴 목록은 피하고 문장 사이를 짧은 문단으로 나누세요.",
    "첨부된 글, 음성, 사진이 있으면 각각 따로 답하지 말고 하나의 질문으로 함께 이해하세요.",
    "사용자 질문에 방언이 있으면 방언 참고 자료를 이용해 표준어 의미로 이해하세요.",
    "이전 대화가 있으면 현재 질문을 가장 최근 대화의 후속 질문으로 먼저 해석하세요.",
    "예를 들어 직전 대화가 토마토주스와 복숭아였고 현재 질문이 '레시피 알려줘'라면, 그 주제의 안전한 레시피를 이어서 답하세요.",
    "이전 질문·답변·현재 질문에 나오지 않은 장어 같은 무관한 식재료를 새 주제로 도입하지 마세요.",
    "아래 DATA는 질문에 실제로 언급된 식재료로 검색된 내부 참고 자료입니다.",
    "DATA의 건강 효능·권장량을 검증된 의학 사실처럼 단정하지 마세요.",
    "사용자 알레르기나 질병 정보와 충돌하거나 불확실하면 안전 원칙을 우선하세요.",
    "risk_level은 danger, caution, safe 중 하나만 사용하세요.",
    "등록 알레르기와 직접 충돌하거나 섭취하지 말아야 한다고 답할 때는 danger로 표시하세요.",
    "불확실하여 전문가 확인이 필요하지만 명확한 금지는 아닐 때만 caution으로 표시하세요.",
    "위험 또는 비권장 상황이면 warning_message에 한 문장의 구체적인 경고를 작성하고, safe이면 빈 문자열로 작성하세요.",
    `사용자 나이대: ${profile.ageBand ?? "미입력"}대`,
    `알레르기: ${profileAllergies.join(", ") || "미입력"}`,
    `질병 정보: ${profileConditions.join(", ") || "미입력"}`,
    `코드가 직접 확인한 알레르기 충돌: ${allergyConflictLabels.join(", ") || "없음"}`,
    `이전 대화: ${JSON.stringify(conversationHistory)}`,
    `질문에서 찾은 방언 참고: ${JSON.stringify(knowledge.dialectHints)}`,
    `기존 방언 참고: ${JSON.stringify(knowledge.legacyDialectTerms)}`,
    `식재료 별칭 참고: ${JSON.stringify(knowledge.foodAliases)}`,
    `관련 요리·재료 DATA: ${JSON.stringify(knowledge.recipes)}`,
    `관련 시니어 식품 DATA: ${JSON.stringify(knowledge.foods)}`,
    `안전 원칙: ${JSON.stringify(knowledge.safetyRules)}`,
    `현재 사용자 글 질문: ${message || "없음. 첨부된 음성이나 사진을 중심으로 답변할 것"}`,
    "반드시 다음 JSON 객체 하나만 반환하세요.",
    '{"answer":"마크다운을 사용할 수 있는 완결된 답변","risk_level":"danger|caution|safe","warning_message":"위험·비권장일 때만 한 문장, 아니면 빈 문자열"}',
  ].join("\n");

  const requestContent: GeminiContent = {
    role: "user",
    parts: [{ text: prompt }],
  };
  if (media.image) {
    requestContent.parts.push({
      inline_data: {
        data: media.image.data,
        mime_type: media.image.mimeType,
      },
    });
  }
  if (media.audio) {
    requestContent.parts.push({
      inline_data: {
        data: media.audio.data,
        mime_type: media.audio.mimeType,
      },
    });
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(textModel)}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents: [requestContent],
        generationConfig: {
          temperature: 0.15,
          maxOutputTokens: 4096,
          responseMimeType: "application/json",
        },
      }),
    },
  );
  const payload = (await response.json()) as GeminiResponse;
  if (!response.ok) {
    throw new Error(payload.error?.message || "Gemini API 호출에 실패했습니다.");
  }

  const generated = payload.candidates?.[0]?.content?.parts
    ?.map((part) => part.text || "")
    .join("")
    .trim();
  if (!generated) throw new Error("Gemini가 빈 답변을 반환했습니다.");

  const result = parseStructuredAnswer(generated);
  if (allergyConflictLabels.length > 0) {
    return {
      ...result,
      riskLevel: "danger",
      warningMessage: localizedAllergyWarning(
        selectedLanguage,
        allergyConflictLabels,
      ),
    };
  }
  if (
    (result.riskLevel === "danger" || result.riskLevel === "caution") &&
    !result.warningMessage
  ) {
    return {
      ...result,
      warningMessage: localizedGeneralWarning(selectedLanguage),
    };
  }
  return result;
}
