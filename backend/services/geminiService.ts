import { getGeminiConfig } from "../config/env";
import {
  findRelevantKnowledge,
  getDrugIdentificationReferenceForPrompt,
  type PillObservation,
} from "../data/loadData";
import { matchFrequentCondition } from "../data/diseaseI18n";
import { higherRisk, type RiskFloorHit } from "../data/loadData";
import { callGeminiGenerateContent } from "./geminiClient";
import { findRuntimePillCandidates } from "./mfdsPillData";
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

export type CaregiverAnswerContext = {
  seniorAlias?: string;
  seniorHistory?: ConversationTurn[];
};

/** 설정 화면에서 음성으로 남긴 상세 설명. 목록으로 고를 수 없는 내용을 담는다. */
export type HealthNote = {
  kind: "allergy" | "condition" | "setup";
  text: string;
};

export type UserGender = "male" | "female";

export type UserProfile = {
  audience?: "senior" | "caregiver";
  language?: string;
  gender?: UserGender;
  ageBand?: number;
  allergies?: string[];
  conditions?: string[];
  allergyIds?: string[];
  conditionIds?: string[];
  healthNotes?: HealthNote[];
};

export type InlineMedia = {
  data: string;
  mimeType: string;
};

/**
 * 어르신이 사진을 찍기 전에 고른 촬영 목적.
 * 같은 사진이라도 성분표를 읽어야 할 때와 음식을 알아봐야 할 때 볼 곳이 다르므로
 * 목적을 받아 Vision 지시를 나눈다.
 */
export type ImagePurpose = "label" | "food" | "medicine";

export const IMAGE_PURPOSES: readonly ImagePurpose[] = ["label", "food", "medicine"];

/** 사진 한 장과 그 사진을 찍은 목적. 한 번에 여러 장을 보낼 수 있다. */
export type InlineImage = {
  media: InlineMedia;
  purpose: ImagePurpose | null;
};

/**
 * 사진에 먹을 것이 없을 때의 지시.
 *
 * 화면의 "밝기와 흔들림은 괜찮아요"는 사진이 밝고 선명한지만 재서 나온 안내이고
 * 무엇이 찍혔는지는 보지 않는다. 그래서 벽이나 사람 사진도 그대로 넘어올 수 있다.
 * 그때 억지로 음식으로 읽으면 엉뚱한 식품 안내가 나가므로 여기서 막는다.
 */
function imageContentGuardInstructions(count: number): string[] {
  if (count === 0) return [];
  const lines = [
    "사진에 음식, 식재료, 식품 성분표, 약 봉투 가운데 아무것도 없으면 억지로 음식으로 해석하지 마세요.",
    "그때는 사진에 무엇이 보이는지 한 문장으로만 말한 뒤, 드시려는 음식이나 성분표를 다시 찍어 달라고 안내하세요.",
    "먹을 것이 없는 사진에는 없는 위험을 만들어 내지 말고 risk_level 은 safe, warning_message 는 빈 문자열로 두세요.",
  ];
  if (count > 1) {
    lines.push(
      "사진 여러 장 중 일부에만 먹을 것이 있으면, 먹을 것이 있는 사진만 판단하고 나머지는 무엇인지만 짧게 언급하세요.",
    );
  }
  return lines;
}

/**
 * 여러 장이 함께 올 때의 지시.
 *
 * 한 상에 여러 반찬이 놓인 경우가 흔해서, 장마다 따로 답하면 어르신이 읽기 어렵다.
 * 그래서 무엇이 있는지 하나씩 짚은 뒤 전체를 함께 판단하도록 지시한다.
 */
function multipleImageInstructions(count: number): string[] {
  if (count < 2) return [];
  return [
    `첨부된 사진이 ${count}장입니다. 한 장만 보고 답하지 말고 모든 사진을 빠짐없이 확인하세요.`,
    "먼저 각 사진에 무엇이 있는지 짧게 하나씩 짚어 말하고, 그다음 전체를 한 끼로 보고 판단하세요.",
    "여러 음식이 함께 있으면 그중 등록된 질병·알레르기에 가장 걸리는 것을 먼저 알리고, 나머지는 뒤에 덧붙이세요.",
    "사진마다 위험도가 다르면 가장 위험한 것을 기준으로 risk_level 을 정하세요.",
  ];
}

/** 촬영 목적별 Vision 지시. 목적이 없으면 기존처럼 사진 전체를 보고 판단한다. */
function imagePurposeInstructions(purpose?: ImagePurpose | null): string[] {
  if (purpose === "label") {
    return [
      "첨부된 사진은 어르신이 '성분표·식품 라벨을 읽어 달라'는 목적으로 찍은 것입니다.",
      "사진에서 제품명, 원재료명, 알레르기 유발물질 표시, 영양성분표(나트륨·당류·포화지방·단백질·열량), 유통기한을 우선 읽으세요.",
      "글자가 잘려서 안 보이는 항목은 추측하지 말고 어떤 부분이 안 보이는지 알려 주고 그 부분을 다시 찍도록 안내하세요.",
      "등록된 알레르기 유발물질이 원재료나 '이 제품은 ○○를 사용한 제품과 같은 시설에서 제조' 문구에 있으면 반드시 먼저 알리세요.",
      "1회 제공량과 총 내용량을 구분해서, 한 번에 얼마나 먹으면 되는지 쉬운 말로 알려 주세요.",
    ];
  }
  if (purpose === "food") {
    return [
      "첨부된 사진은 어르신이 '이 음식이나 식재료가 무엇인지, 먹어도 되는지' 물어보려고 찍은 것입니다.",
      "사진 속 음식이나 식재료의 이름을 먼저 말하고, 확실하지 않으면 단정하지 말고 비슷한 후보를 말하며 확인을 부탁하세요.",
      "겉모습으로 상함·곰팡이·싹·변색이 보이면 먹지 말라고 분명히 말하세요. 보이지 않으면 겉모습만으로 상태를 단정하지 마세요.",
      "등록된 질병과 알레르기 기준으로 먹어도 되는지, 얼마나 먹으면 되는지, 어떻게 조리하면 더 안전한지 알려 주세요.",
      "사진만으로 나트륨·당류 같은 수치를 숫자로 단정하지 말고 대략적인 정도로만 설명하세요.",
    ];
  }
  if (purpose === "medicine") {
    return [
      "첨부된 사진은 어르신이 약 봉투·포장·낱알을 확인하거나 함께 먹으면 안 되는 음식을 물어보려고 찍은 것입니다.",
      "약 봉투나 포장이면 제품명·함량·제조사와 복용법(하루 몇 번, 식전·식후)을 보이는 그대로 읽으세요.",
      "낱알이면 앞뒷면 각인, 모양, 색, 제형, 분할선을 순서대로 관찰하고, 색과 모양만으로 특정 약 이름을 단정하지 마세요.",
      "약 이름이나 각인이 흐릿하거나 일부만 보이면 절대 비슷한 약으로 추측하지 말고, 앞면·뒷면·포장을 다시 찍거나 약사에게 실물을 확인하도록 안내하세요.",
      "읽은 약과 관련해 피해야 할 음식(예: 항응고제와 비타민K 많은 채소, 일부 약과 자몽)이 내부 참고 자료에 있으면 그 범위에서만 알려 주세요.",
      "복용량 조절, 복용 중단, 다른 약으로 바꾸기는 절대 안내하지 말고 의사·약사 확인을 권하세요.",
    ];
  }
  return [];
}

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

type MedicinePhotoObservation = PillObservation & {
  photoNumbers: number[];
  confidence: "high" | "medium" | "low";
  unreadable: string[];
};

function cleanObservationText(value: unknown) {
  return typeof value === "string" ? value.trim().slice(0, 120) : "";
}

function parseMedicinePhotoObservations(raw: string): MedicinePhotoObservation[] {
  const parsed = JSON.parse(raw) as { observations?: unknown };
  if (!Array.isArray(parsed.observations)) return [];

  return parsed.observations.slice(0, 8).map((entry, index) => {
    const value = entry && typeof entry === "object" ? entry as Record<string, unknown> : {};
    const photoNumbers = Array.isArray(value.photoNumbers)
      ? value.photoNumbers
          .map((item) => Number(item))
          .filter((item) => Number.isInteger(item) && item > 0)
          .slice(0, 6)
      : [index + 1];
    const confidence = value.confidence === "high" || value.confidence === "medium"
      ? value.confidence
      : "low";
    return {
      photoNumbers,
      productText: cleanObservationText(value.productText),
      manufacturerText: cleanObservationText(value.manufacturerText),
      imprintFront: cleanObservationText(value.imprintFront),
      imprintBack: cleanObservationText(value.imprintBack),
      dosageForm: cleanObservationText(value.dosageForm),
      shape: cleanObservationText(value.shape),
      colorFront: cleanObservationText(value.colorFront),
      colorBack: cleanObservationText(value.colorBack),
      scoreLineFront: cleanObservationText(value.scoreLineFront),
      scoreLineBack: cleanObservationText(value.scoreLineBack),
      confidence,
      unreadable: Array.isArray(value.unreadable)
        ? value.unreadable.map(cleanObservationText).filter(Boolean).slice(0, 8)
        : [],
    };
  });
}

/**
 * 약 사진에서 식별에 필요한 관찰값을 한 번 구조화한다.
 * 이 단계는 제품명을 맞히는 모델 호출이 아니라 사진에서 보이는 글자와 외형을
 * 추출하는 단계이며, 실제 후보명은 D1의 공식 데이터 검색이 고른다.
 */
async function inspectMedicinePhotos(
  images: InlineImage[],
  apiKey: string,
  models: string[],
): Promise<MedicinePhotoObservation[]> {
  if (images.length === 0) return [];

  const content: GeminiContent = {
    role: "user",
    parts: [{
      text: [
        "당신은 약 이름을 추측하는 사람이 아니라 약 사진의 관찰값을 옮기는 기록자입니다.",
        `사진은 ${images.length}장입니다. 같은 약의 앞뒷면이면 한 관찰값으로 묶고 photoNumbers에 사진 번호를 모두 적으세요. 서로 다른 약이면 나누세요.`,
        "포장에 실제로 인쇄된 제품명만 productText에 적으세요. 낱알 외형만 보고 제품명을 만들지 마세요.",
        "각인은 대소문자, 숫자, 로고 순서를 보이는 그대로 적고 읽을 수 없으면 빈 문자열로 두고 unreadable에 이유를 적으세요.",
        "색은 조명의 영향을 받으므로 보이는 색만 적고, 정제·경질캡슐·연질캡슐 등 제형을 구분하세요.",
        "반드시 JSON 하나만 반환하세요.",
        '{"observations":[{"photoNumbers":[1],"productText":"","manufacturerText":"","imprintFront":"","imprintBack":"","dosageForm":"","shape":"","colorFront":"","colorBack":"","scoreLineFront":"","scoreLineBack":"","confidence":"high|medium|low","unreadable":[]}]}',
      ].join("\n"),
    }],
  };
  for (const image of images) {
    content.parts.push({
      inline_data: {
        data: image.media.data,
        mime_type: image.media.mimeType,
      },
    });
  }

  try {
    const { rawBody } = await callGeminiGenerateContent({
      apiKey,
      models,
      body: {
        contents: [content],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 1200,
          responseMimeType: "application/json",
        },
      },
    });
    const payload = JSON.parse(rawBody) as GeminiResponse;
    const generated = payload.candidates?.[0]?.content?.parts
      ?.map((part) => part.text || "")
      .join("")
      .trim();
    return generated ? parseMedicinePhotoObservations(generated) : [];
  } catch (error) {
    console.warn(
      "[SilverLens] 약 사진 관찰값을 별도로 추출하지 못해 기본 사진 판독으로 계속합니다.",
      error instanceof Error ? error.message : error,
    );
    return [];
  }
}

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

/**
 * 같은 질문을 다시 물었을 때 Gemini를 또 부르지 않도록 답변을 잠깐 보관한다.
 * 무료 한도가 하루 수십 건이라 시연 중 반복 질문 한 번을 아끼는 것도 크다.
 */
const ANSWER_CACHE_TTL_MS = 15 * 60 * 1000;
const ANSWER_CACHE_MAX = 60;
const answerCache = new Map<string, { savedAt: number; result: SeniorAnswerResult }>();

/** base64 전체를 키로 쓰면 메모리가 커지므로 길이와 앞뒤 일부만 지문으로 쓴다. */
function mediaFingerprint(media?: InlineMedia | null) {
  if (!media) return "none";
  const { data, mimeType } = media;
  return `${mimeType}:${data.length}:${data.slice(0, 48)}:${data.slice(-48)}`;
}

function readAnswerCache(key: string) {
  const hit = answerCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.savedAt > ANSWER_CACHE_TTL_MS) {
    answerCache.delete(key);
    return null;
  }
  // 최근에 쓴 항목을 뒤로 보내 가장 오래된 것부터 지워지게 한다.
  answerCache.delete(key);
  answerCache.set(key, hit);
  return hit.result;
}

function writeAnswerCache(key: string, result: SeniorAnswerResult) {
  answerCache.set(key, { savedAt: Date.now(), result });
  while (answerCache.size > ANSWER_CACHE_MAX) {
    const oldest = answerCache.keys().next().value;
    if (oldest === undefined) break;
    answerCache.delete(oldest);
  }
}

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

/**
 * 안전 규칙이 걸렸을 때 쓰는 경고 문구.
 * 모델이 위험도를 낮게 매겨도 이 문구로 이유를 분명히 알려 준다.
 */
/**
 * 성별은 권장 섭취량 기준이 달라지는 항목에만 쓴다.
 * 답변 언어에 맞춰 표기해야 모델이 엉뚱한 언어로 되받지 않는다.
 */
function localizedGenderLabel(gender: UserGender | undefined, language: string) {
  if (!gender) {
    if (language === "en-US") return "not provided";
    if (language === "ja-JP") return "未入力";
    return "미입력";
  }
  if (language === "en-US") return gender === "male" ? "male" : "female";
  if (language === "ja-JP") return gender === "male" ? "男性" : "女性";
  return gender === "male" ? "남성" : "여성";
}

function localizedRuleWarning(
  language: string | undefined,
  hits: RiskFloorHit[],
) {
  const foods = [...new Set(hits.flatMap((hit) => hit.matchedFoods))].join(", ");
  if (language === "en-US") {
    return `Caution: ${foods} conflicts with a safety rule for your registered conditions. Please check with your doctor or pharmacist first.`;
  }
  if (language === "ja-JP") {
    return `注意：${foods}は登録された病気の安全基準に触れます。先に医師または薬剤師に確認してください。`;
  }
  return `주의: ${foods}은(는) 등록된 질병의 안전 기준에 걸립니다. 드시기 전에 의사나 약사에게 확인해 주세요.`;
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
  if (
    knowledge.dialectHints.length > 0 ||
    knowledge.recipes.length > 0 ||
    knowledge.globalDishes.length > 0 ||
    knowledge.foods.length > 0 ||
    knowledge.dishNameHints.length > 0 ||
    knowledge.foodAliasHints.length > 0
  ) {
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

function sanitizeHistory(history: ConversationTurn[], maxTurns = 6) {
  return history
    .filter(
      (turn) =>
        isMeaningfulText(turn.question) &&
        isMeaningfulText(turn.answer),
    )
    .slice(-maxTurns)
    .map((turn) => ({
      question: turn.question.trim().slice(0, 1000),
      answer: turn.answer.trim().slice(0, 2200),
    }));
}

export async function generateSeniorFriendlyAnswer(
  message: string,
  profile: UserProfile = {},
  media: {
    audio?: InlineMedia | null;
    /** 사진은 여러 장을 받는다. 어르신이 한 상을 여러 번 찍어 보내는 경우가 있다. */
    images?: InlineImage[];
  } = {},
  history: ConversationTurn[] = [],
  caregiverContext: CaregiverAnswerContext = {},
): Promise<SeniorAnswerResult> {
  const { apiKey, textModelChain } = getGeminiConfig();
  const conversationHistory = sanitizeHistory(history);
  const topicContext = [
    ...conversationHistory.slice(-3).map((turn) => turn.question),
    message,
  ]
    .filter(Boolean)
    .join("\n");
  const selectedLanguage = toHealthLanguage(profile.language);
  const isCaregiverAudience = profile.audience === "caregiver";
  const linkedSeniorHistory = isCaregiverAudience
    ? sanitizeHistory(caregiverContext.seniorHistory ?? [], 12)
    : [];
  const linkedSeniorAlias = isCaregiverAudience
    ? caregiverContext.seniorAlias?.trim().slice(0, 30) || "선택된 시니어 없음"
    : "";

  const profileAllergies =
    profile.allergies ??
    (profile.allergyIds ?? []).map((id) => getHealthLabel(id, selectedLanguage));
  // 카탈로그에 없는 질병을 직접 입력한 경우 노인 다빈도 상병 표기로 맞춰 준다.
  const profileConditions = (
    profile.conditions ??
    (profile.conditionIds ?? []).map((id) => getHealthLabel(id, selectedLanguage))
  ).map((label) => matchFrequentCondition(label)?.name ?? label);

  const healthNoteLines = (profile.healthNotes ?? [])
    .filter((note) => isMeaningfulText(note?.text))
    .slice(-8)
    .map((note) => ({ kind: note.kind, text: note.text.trim().slice(0, 400) }));

  const knowledge = findRelevantKnowledge(topicContext, {
    language: selectedLanguage,
    conditionLabels: profileConditions,
    conditionIds: profile.conditionIds ?? [],
  });

  // 첨부 파일이 없고 글로만 질문했는데 시니어 식품·건강 서비스와 무관한 주제이면
  // Gemini API를 호출하지 않고 바로 안내 답변을 돌려줘 토큰 낭비를 막습니다.
  const images = media.images ?? [];
  const medicineImages = images.filter((image) => image.purpose === "medicine");
  const isDrugIdentificationRequest =
    medicineImages.length > 0 ||
    /(약\s*사진|약\s*봉투|알약|낱알|각인|무슨\s*약|약\s*이름)/u.test(message);
  const medicinePhotoObservations = await inspectMedicinePhotos(
    medicineImages,
    apiKey,
    textModelChain,
  );
  const medicineCandidateGroups = await Promise.all(
    medicinePhotoObservations.map(async (observation) => ({
      observation,
      candidates: await findRuntimePillCandidates(observation, 5),
    })),
  );
  const drugIdentificationReference = isDrugIdentificationRequest
    ? getDrugIdentificationReferenceForPrompt()
    : null;
  const hasMedia = Boolean(media.audio || images.length > 0);
  if (
    !isCaregiverAudience &&
    !hasMedia &&
    isMeaningfulText(message) &&
    !isLikelyOnTopic(topicContext, knowledge)
  ) {
    return {
      answer: localizedOffTopicAnswer(selectedLanguage),
      riskLevel: "safe",
      warningMessage: "",
    };
  }

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
    isCaregiverAudience
      ? "당신은 시니어를 돌보는 보호자·요양보호사의 실무와 일상 질문을 폭넓게 지원하는 돌봄 보조 AI입니다."
      : "당신은 시니어에게 식재료와 조리 정보를 쉬운 말로 설명하는 보조 AI입니다.",
    isCaregiverAudience
      ? "돌봄이의 질문은 음식·건강으로 주제를 제한하지 마세요. 일반 지식, 일정 정리, 문장 작성, 요약 등에도 가능한 범위에서 직접 답하세요."
      : "음식·영양·건강·사투리·서비스 이용과 무관한 질문(예: 스포츠 선수, 연예인, 시사, 일반 상식)이면 관련 지식으로 답하지 말고, 시니어 식품·영양 정보를 돕는 AI임을 밝히고 음식이나 건강 관련 질문을 다시 안내하세요.",
    answerLanguageInstruction(selectedLanguage),
    "의학적 진단이나 치료 지시를 하지 말고, 위험 가능성이 있으면 의료진 또는 약사 확인을 권하세요.",
    "등록된 알레르기 식품을 추천하거나 레시피 재료로 넣지 마세요.",
    "알레르기는 등록된 식품과 그 파생 재료에만 적용하세요. 알레르기 정보만으로 소금처럼 무관한 재료까지 금지하지 마세요.",
    "재료를 바꿀 때는 같은 조리 역할끼리 바꾸세요. 밀가루는 반죽·튀김옷·농도용 재료이지 간을 맞추는 양념이 아니므로, '소금이나 밀가루 대신'처럼 서로 역할이 다른 재료를 한데 묶지 마세요.",
    "밀 알레르기에는 밀가루가 필요한 자리만 쌀가루·감자전분 등 안전한 대체재로 바꾸고, 우유 알레르기에는 유제품이 필요한 자리만 알레르기 없는 비유제품으로 바꾸세요.",
    "고혈압·심부전·신장질환 등 나트륨 제한 근거가 등록되어 있지 않다면 소금을 임의로 금지하지 마세요. 간장도 밀·대두 알레르기 여부와 나트륨 제한을 각각 확인한 뒤 안내하세요.",
    "대체 식재료를 제안하기 전에 그 재료가 무엇을 대신하는지 한 번 확인하고, 맛내기·반죽·농도·유제품 역할에 맞는 현실적인 대체재만 제시하세요.",
    isCaregiverAudience
      ? "첫 문장에서 결론을 말하고, 돌봄이가 바로 행동으로 옮길 수 있도록 확인할 점과 다음 행동을 구분해 간결하게 설명하세요."
      : "첫 문장에서 결론을 말하고, 꼭 필요한 내용만 보통 6~9개의 짧은 문장으로 설명하세요.",
    "문장 하나에는 핵심 하나만 담고, 한 문단은 1~2개의 짧은 문장으로 작성하세요.",
    isCaregiverAudience
      ? "전문용어가 필요하면 쉬운 뜻을 바로 덧붙이고, 긴 표 대신 짧은 제목과 목록을 사용하세요. 어르신에게 직접 전달할 표현이 있으면 따옴표로 짧게 제시하세요."
      : "TTS로 자연스럽게 읽히도록 표와 긴 목록은 피하고 문장 사이를 짧은 문단으로 나누세요.",
    "첨부된 글, 음성, 사진이 있으면 각각 따로 답하지 말고 하나의 질문으로 함께 이해하세요.",
    // 사진에 먹을 것이 없으면 억지로 판단하지 않게 먼저 막는다.
    ...imageContentGuardInstructions(images.length),
    // 여러 장이면 전부 확인하도록 먼저 못 박는다.
    ...multipleImageInstructions(images.length),
    // 촬영 목적을 고른 경우에만 사진을 어떻게 볼지 좁혀 준다.
    // 목적이 섞여 있으면(성분표 + 음식) 각 목적의 지시를 겹치지 않게 모아 넣는다.
    ...[...new Set(images.map((image) => image.purpose).filter(Boolean))].flatMap(
      (purpose) => imagePurposeInstructions(purpose as ImagePurpose),
    ),
    ...(drugIdentificationReference
      ? [
          "약 사진은 아래 식약처 낱알식별 기준에 따라 관찰하되, 외형만으로 제품을 확정하지 마세요.",
          "식약처 후보가 비어 있으면 특정 제품명을 새로 만들어 말하지 마세요. 포장에 선명하게 인쇄된 제품명은 그대로 읽어 줄 수 있습니다.",
          "후보가 있어도 '가능한 후보'로만 말하고 사진의 각인·함량·제조사와 공식 정보 또는 약사 확인이 끝나기 전에는 복용해도 된다고 판단하지 마세요.",
          `약 사진 식별 기준 DATA: ${JSON.stringify(drugIdentificationReference)}`,
          `약 사진 관찰값과 식약처 후보 DATA: ${JSON.stringify(medicineCandidateGroups)}`,
        ]
      : []),
    "사용자 질문에 방언이 있으면 방언 참고 자료를 이용해 표준어 의미로 이해하세요.",
    "이전 대화가 있으면 현재 질문을 가장 최근 대화의 후속 질문으로 먼저 해석하세요.",
    "예를 들어 직전 대화가 토마토주스와 복숭아였고 현재 질문이 '레시피 알려줘'라면, 그 주제의 안전한 레시피를 이어서 답하세요.",
    "이전 질문·답변·현재 질문에 나오지 않은 장어 같은 무관한 식재료를 새 주제로 도입하지 마세요.",
    "아래 DATA는 질문에 실제로 언급된 식재료로 검색된 내부 참고 자료입니다.",
    "DATA의 건강 효능·권장량을 검증된 의학 사실처럼 단정하지 마세요.",
    "외래어·별칭 참고가 있으면 어르신이 알아듣기 쉬운 우리말 이름을 먼저 말하고 원래 이름을 괄호로 덧붙이세요.",
    "한식 메뉴명 참고에 걸린 이름은 실제로 존재하는 한식이므로 모르는 음식으로 처리하지 마세요.",
    "외국 음식 DATA에 걸린 음식은 어르신에게 낯선 이름입니다. 어떤 나라 음식이고 어떤 재료로 만드는 음식인지 한 문장으로 먼저 풀어 준 뒤 답하세요.",
    "외국 음식을 설명할 때도 재료를 기준으로 등록된 알레르기와 질병에 맞는지 함께 확인하고, 우리 식재료로 바꿀 수 있으면 그 방법을 알려 주세요.",
    "적용할 안전 원칙은 사용자 질병·질문에 맞게 미리 골라 둔 것입니다. 해당 원칙과 어긋나는 조리법이나 식재료를 권하지 마세요.",
    "음성으로 남긴 상세 메모는 목록으로 고를 수 없는 개인 사정입니다. 목록으로 등록한 알레르기·질병보다 구체적이므로 함께 반영하세요.",
    "예를 들어 목록에는 견과류만 등록됐지만 메모에 '견과류 중에 특히 호두가 안 맞는다'가 있으면 호두를 특히 강하게 피하도록 안내하세요.",
    "메모 내용과 목록이 어긋나면 더 조심스러운 쪽을 따르고, 메모를 근거로 새 질병을 진단하지는 마세요.",
    "성별과 나이대는 하루 권장 섭취량 기준이 달라지는 부분에만 쓰세요. 철분은 폐경 전 여성이 더 필요하고, 칼슘과 비타민D는 여성의 골다공증 위험이 높고, 퓨린과 요산은 남성의 통풍 위험이 높으며, 하루 열량과 단백질 권장량도 체격 차이로 다릅니다.",
    "성별만으로 질병을 추정하거나 단정하지 마세요. 성별이 미입력이면 성별과 무관한 일반 기준으로 설명하세요.",
    "성역할을 가정하는 표현을 쓰지 마세요. 조리를 누가 하는지, 가족 중 누가 챙겨주는지 임의로 단정하지 마세요.",
    "사용자 알레르기나 질병·건강 상태와 충돌하거나 불확실하면 안전 원칙을 우선하세요.",
    ...(isCaregiverAudience
      ? [
          "선택한 시니어의 최근 대화는 사실 확인과 반복된 관심사 파악을 위한 읽기 전용 참고자료입니다.",
          "최근 대화에 없는 사실이나 시니어의 의도·감정·증상을 추측하지 마세요. 자료가 부족하면 확인할 수 없다고 분명히 말하세요.",
          "최근 대화를 요약하거나 반복된 걱정을 찾을 때는 아래에 제공된 시니어 앱 최근 대화만 근거로 사용하고, 돌봄이와 AI의 이전 대화와 섞지 마세요.",
          "시니어의 민감한 건강정보는 현재 돌봄 목적의 답변에 필요한 범위에서만 언급하세요.",
        ]
      : []),
    "risk_level은 danger, caution, safe 중 하나만 사용하세요.",
    "등록 알레르기와 직접 충돌하거나 섭취하지 말아야 한다고 답할 때는 danger로 표시하세요.",
    "불확실하여 전문가 확인이 필요하지만 명확한 금지는 아닐 때만 caution으로 표시하세요.",
    "위험 또는 비권장 상황이면 warning_message에 한 문장의 구체적인 경고를 작성하고, safe이면 빈 문자열로 작성하세요.",
    `사용자 성별: ${localizedGenderLabel(profile.gender, selectedLanguage)}`,
    `사용자 나이대: ${profile.ageBand ?? "미입력"}대`,
    `알레르기: ${profileAllergies.join(", ") || "미입력"}`,
    `질병·건강 상태: ${profileConditions.join(", ") || "미입력"}`,
    `코드가 직접 확인한 알레르기 충돌: ${allergyConflictLabels.join(", ") || "없음"}`,
    `어르신이 음성으로 남긴 상세 메모: ${
      healthNoteLines.length > 0 ? JSON.stringify(healthNoteLines) : "없음"
    }`,
    `${isCaregiverAudience ? "현재 돌봄이 AI 대화의 이전 내용" : "이전 대화"}: ${JSON.stringify(conversationHistory)}`,
    ...(isCaregiverAudience
      ? [
          `선택한 시니어: ${linkedSeniorAlias}`,
          `시니어 앱 최근 대화: ${
            linkedSeniorHistory.length > 0
              ? JSON.stringify(linkedSeniorHistory)
              : "제공된 대화 없음"
          }`,
        ]
      : []),
    `질문에서 찾은 방언 참고: ${JSON.stringify(knowledge.dialectHints)}`,
    `질문에서 찾은 외래어·별칭 참고: ${JSON.stringify(knowledge.foodAliasHints)}`,
    `질문에서 찾은 한식 메뉴명 참고: ${JSON.stringify(knowledge.dishNameHints)}`,
    `관련 요리·재료 DATA: ${JSON.stringify(knowledge.recipes)}`,
    `관련 외국 음식 DATA: ${JSON.stringify(knowledge.globalDishes)}`,
    `관련 시니어 식품 DATA: ${JSON.stringify(knowledge.foods)}`,
    `적용할 안전 원칙: ${JSON.stringify(knowledge.safetyRules)}`,
    `현재 사용자 글 질문: ${message || "없음. 첨부된 음성이나 사진을 중심으로 답변할 것"}`,
    "반드시 다음 JSON 객체 하나만 반환하세요.",
    '{"answer":"마크다운을 사용할 수 있는 완결된 답변","risk_level":"danger|caution|safe","warning_message":"위험·비권장일 때만 한 문장, 아니면 빈 문자열"}',
  ].join("\n");

  const requestContent: GeminiContent = {
    role: "user",
    parts: [{ text: prompt }],
  };
  // 사진은 보낸 순서대로 넣는다. 순서가 프롬프트의 "몇 번째 사진"과 맞아야 한다.
  for (const image of images) {
    requestContent.parts.push({
      inline_data: {
        data: image.media.data,
        mime_type: image.media.mimeType,
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

  const imageFingerprint = images
    .map((image) => mediaFingerprint(image.media))
    .join("|");
  const cacheKey = `${prompt}\n@@image:${imageFingerprint || "none"}\n@@audio:${mediaFingerprint(media.audio)}`;
  // 촬영 목적은 프롬프트 지시문에 이미 섞여 들어가므로 cacheKey에 따로 붙이지 않는다.
  const cachedAnswer = readAnswerCache(cacheKey);
  if (cachedAnswer) {
    console.info("[SilverLens] 같은 질문이라 보관해 둔 답변을 다시 씁니다.");
    return cachedAnswer;
  }

  const { rawBody, modelUsed } = await callGeminiGenerateContent({
    apiKey,
    models: textModelChain,
    language: selectedLanguage,
    body: {
      contents: [requestContent],
      generationConfig: {
        temperature: 0.15,
        maxOutputTokens: 4096,
        responseMimeType: "application/json",
      },
    },
  });
  if (modelUsed !== textModelChain[0]) {
    console.info(`[SilverLens] 예비 모델로 답변했습니다: ${modelUsed}`);
  }
  const payload = JSON.parse(rawBody) as GeminiResponse;

  const generated = payload.candidates?.[0]?.content?.parts
    ?.map((part) => part.text || "")
    .join("")
    .trim();
  if (!generated) throw new Error("Gemini가 빈 답변을 반환했습니다.");

  const parsed = parseStructuredAnswer(generated);
  const result = applySafetyFloor(
    parsed,
    selectedLanguage,
    allergyConflictLabels,
    knowledge.riskFloorHits,
  );

  writeAnswerCache(cacheKey, result);
  return result;
}

/**
 * 모델이 매긴 위험도를 코드가 다시 검사해 하한선을 보장한다.
 *
 * 실측에서 작은 모델이 신장질환자에게 바나나를 "하루 반 개"로 권한 사례가 있었다.
 * 안전 판정을 확률적인 모델 출력에만 맡기지 않으려는 장치다.
 * 우선순위는 등록 알레르기 직접 충돌 > 안전 규칙 하한선 > 모델 판정 순이다.
 */
function applySafetyFloor(
  parsed: SeniorAnswerResult,
  language: string,
  allergyConflictLabels: string[],
  riskFloorHits: RiskFloorHit[],
): SeniorAnswerResult {
  if (allergyConflictLabels.length > 0) {
    return {
      ...parsed,
      riskLevel: "danger",
      warningMessage: localizedAllergyWarning(language, allergyConflictLabels),
    };
  }

  if (riskFloorHits.length > 0) {
    const floor = riskFloorHits.reduce<RiskLevel>(
      (current, hit) => higherRisk(current, hit.floor),
      "safe",
    );
    const raised = higherRisk(parsed.riskLevel, floor);
    if (raised !== parsed.riskLevel) {
      console.info(
        `[SilverLens] 안전 규칙으로 위험도를 올렸습니다: ${parsed.riskLevel} → ${raised} (${riskFloorHits
          .map((hit) => `${hit.ruleId}:${hit.matchedFoods.join("/")}`)
          .join(", ")})`,
      );
    }
    return {
      ...parsed,
      riskLevel: raised,
      warningMessage:
        parsed.warningMessage || localizedRuleWarning(language, riskFloorHits),
    };
  }

  if (
    (parsed.riskLevel === "danger" || parsed.riskLevel === "caution") &&
    !parsed.warningMessage
  ) {
    return { ...parsed, warningMessage: localizedGeneralWarning(language) };
  }
  return parsed;
}
