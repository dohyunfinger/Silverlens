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
  if (language === "ja-JP") {
    return "回答と警告文をすべて日本語で書いてください。";
  }
  return "답변과 경고 문구 전체를 한국어로 작성하세요.";
}

function localizedAllergyWarning(language: string | undefined, labels: string[]) {
  const joined = labels.join(", ");
  if (language === "en-US") {
    return `Warning: ${joined} matches the user's registered allergy information. Do not use or consume it.`;
  }
  if (language === "ja-JP") {
    return `警告：${joined}は登録されたアレルギー情報と一致します。使用したり食べたりしないでください。`;
  }
  return `경고: ${joined}은(는) 등록된 알레르기 식품과 일치하므로 사용하거나 섭취하지 마세요.`;
}

function localizedGeneralWarning(language?: string) {
  if (language === "en-US") {
    return "Caution: This food may not be recommended for the user's current profile. Check the explanation before eating it.";
  }
  if (language === "ja-JP") {
    return "注意：現在の健康情報を基準にすると、この食品はおすすめできない可能性があります。食べる前に説明を確認してください。";
  }
  return "주의: 현재 건강정보를 기준으로 권장하지 않거나 확인이 필요한 음식입니다. 섭취 전 설명을 확인하세요.";
}

function localizedOffTopicAnswer(language?: string) {
  if (language === "en-US") {
    return "I'm an AI that only helps with senior-friendly food, nutrition, and health information. I can't answer that question, but feel free to ask me about a food, ingredient, recipe, or health concern instead.";
  }
  if (language === "ja-JP") {
    return "私は高齢者向けの食品・栄養・健康情報をお手伝いするAIです。その質問には答えにくいです。代わりに、食品、材料、レシピ、健康に関する内容を聞いてください。";
  }
  return "저는 시니어 식품·영양·건강 정보를 도와드리는 AI입니다. 그 질문에는 답변드리기 어려워요. 대신 궁금하신 음식, 재료, 요리법, 건강 관련 내용을 물어봐 주세요.";
}

/**
 * 실제 Gemini 호출 전에 값싸게(=토큰 소모 없이) 걸러내는 1차 주제 확인 로직.
 * 음성/사진 첨부가 있으면 항상 식품·건강 관련 질문으로 간주해 통과시키고,
 * 텍스트만 있는 경우에만 아래 신호로 시니어 식품/건강 서비스 주제인지 판단합니다.
 */
const ON_TOPIC_KEYWORDS = [
  // 음식/식재료/조리
  "음식", "식사", "먹", "드시", "드셔", "반찬", "국", "찌개", "나물", "채소",
  "야채", "과일", "고기", "생선", "해산물", "쌀", "밥", "죽", "간식", "음료",
  "물", "수분", "요리", "조리", "레시피", "재료", "곡물", "김치", "국물",
  "양념", "간", "짜", "달", "매워", "매운",
  // 영양/건강
  "영양", "칼로리", "혈압", "당뇨", "고혈압", "콜레스테롤", "알레르기", "알러지",
  "질병", "증상", "약", "복용", "소화", "비타민", "미네랄", "단백질", "지방",
  "탄수화물", "저염", "저당", "다이어트", "체중", "영양제", "건강", "식단",
  "섭취", "치아", "잇몸", "씹",
  // 사투리/방언
  "사투리", "방언", "표준어", "정구지", "무시",
  // 서비스 사용 관련
  "실버렌즈", "서비스", "사용법", "이용", "가입", "로그인", "프로필",
  "언어 설정", "설정", "도움말", "사용방법",
  // 인사/일상 대화(가벼운 스몰토크는 허용)
  "안녕", "고마워", "감사", "반가워", "수고",
];

function isLikelyOnTopic(topicContext: string, knowledge: ReturnType<typeof findRelevantKnowledge>) {
  if (knowledge.dialectHints.length > 0 || knowledge.recipes.length > 0 || knowledge.foods.length > 0) {
    return true;
  }
  const normalized = topicContext.normalize("NFKC");
  return ON_TOPIC_KEYWORDS.some((keyword) => normalized.includes(keyword));
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

  // 첨부 파일이 없고 글로만 질문했는데 시니어 식품·건강 서비스와 무관한 주제이면
  // Gemini API를 호출하지 않고 바로 안내 답변을 돌려줘 토큰 낭비를 막습니다.
  const hasMedia = Boolean(media.audio || media.image);
  if (!hasMedia && isMeaningfulText(message) && !isLikelyOnTopic(topicContext, knowledge)) {
    return {
      answer: localizedOffTopicAnswer(selectedLanguage),
      riskLevel: "safe",
      warningMessage: "",
    };
  }

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
    "음식·영양·건강·사투리·서비스 이용과 무관한 질문(예: 스포츠 선수, 연예인, 시사, 일반 상식)이면 관련 지식으로 답하지 말고, 시니어 식품·영양 정보를 돕는 AI임을 밝히고 음식이나 건강 관련 질문을 다시 안내하세요.",
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
