import { NextResponse } from "next/server";
import { isDataLogEnabled } from "../../../backend/config/env";
import {
  findRelevantKnowledge,
  getDialectDictionaryForPrompt,
  getKnowledgeStats,
} from "../../../backend/data/loadData";
import {
  getDiseaseI18nEntries,
  getSeniorFrequentConditions,
  localizeDiseaseName,
  matchFrequentCondition,
} from "../../../backend/data/diseaseI18n";
import {
  getHealthGroupOptions,
  getHealthTerms,
  resolveHealthTermId,
} from "../../../backend/data/healthTerms";
import { getGeminiModelCooldowns } from "../../../backend/services/geminiClient";
import { getNarrationCacheStats } from "../../../backend/services/ttsService";

/**
 * 임시 점검용 엔드포인트입니다.
 * data 폴더의 지식 자료가 실제로 백엔드에 붙었는지 눈으로 확인하는 목적이라
 * 기본적으로 개발 환경에서만 열립니다. 배포 환경에서 확인이 필요하면
 * SILVERLENS_ENABLE_LOG=true 를 설정하세요. API 키 같은 비밀값은 값이 아니라
 * "설정됨 / 없음" 여부만 돌려줍니다.
 *
 * 열림 여부는 backend/config/env.ts 의 isDataLogEnabled 한 곳에서만 판단해
 * /log 화면과 기준이 어긋나지 않게 합니다.
 */
const SAMPLE_QUESTION =
  "정구지랑 무시 넣고 제육볶음 하려는데 브로컬리도 괜찮아요? 무루팍이 시원찮아서요";

/** 화면 언어는 정해진 세 값만 받는다. 값이 그대로 검색·번역에 쓰이기 때문이다. */
const SUPPORTED_LANGUAGES = ["ko-KR", "en-US", "ja-JP"];
const MAX_CONDITION_ITEMS = 40;
const MAX_CONDITION_LENGTH = 60;

/** 주소창으로 들어오는 값이라 개수와 길이를 서버에서 잘라 낸다. */
function cleanConditionList(raw: string) {
  return raw
    .split(",")
    .map((item) => item.trim().slice(0, MAX_CONDITION_LENGTH))
    .filter(Boolean)
    .slice(0, MAX_CONDITION_ITEMS);
}

export async function GET(request: Request) {
  if (!isDataLogEnabled()) {
    return NextResponse.json(
      { error: "로그 화면이 꺼져 있습니다. SILVERLENS_ENABLE_LOG=true 로 열 수 있습니다." },
      { status: 404 },
    );
  }

  const url = new URL(request.url);
  const question = (url.searchParams.get("q") || SAMPLE_QUESTION).slice(0, 400);
  const requestedLanguage = url.searchParams.get("language") || "ko-KR";
  const language = SUPPORTED_LANGUAGES.includes(requestedLanguage)
    ? requestedLanguage
    : "ko-KR";
  // 값이 비어 있는 채로 넘어오면 "질병 없음"으로 다뤄야 하므로 ?? 로 판단한다.
  const rawConditions = url.searchParams.get("conditions");
  const conditionLabels = cleanConditionList(rawConditions ?? "당뇨, 만성 신장질환");
  const conditionIds = cleanConditionList(url.searchParams.get("conditionIds") || "");

  const stats = getKnowledgeStats();
  const knowledge = findRelevantKnowledge(question, {
    language,
    conditionLabels: conditionIds.length > 0 ? [] : conditionLabels,
    conditionIds,
  });
  const allergyGroups = getHealthGroupOptions("allergy", language);
  const conditionGroups = getHealthGroupOptions("condition", language);
  const groupedAllergyCount = allergyGroups.reduce(
    (total, group) => total + group.items.length,
    0,
  );
  const groupedConditionCount = conditionGroups.reduce(
    (total, group) => total + group.items.length,
    0,
  );

  return NextResponse.json({
    checkedAt: new Date().toISOString(),
    environment: {
      nodeEnv: process.env.NODE_ENV ?? "unknown",
      geminiApiKey: process.env.GEMINI_API_KEY ? "설정됨" : "없음",
      geminiTextModel: process.env.GEMINI_TEXT_MODEL ?? "기본값(gemini-3.6-flash)",
      geminiTtsModel:
        process.env.GEMINI_TTS_MODEL ?? "기본값(gemini-2.5-flash-preview-tts)",
      dialectApiUrl: process.env.NEXT_PUBLIC_DIALECT_API_URL ?? "미설정",
    },
    modelCooldowns: getGeminiModelCooldowns(),
    narrationCache: getNarrationCacheStats(),
    datasets: {
      ...stats.counts,
      diseaseI18n: getDiseaseI18nEntries().length,
      seniorFrequentConditions: getSeniorFrequentConditions().length,
      healthTermsAllergy: getHealthTerms("allergy").length,
      healthTermsCondition: getHealthTerms("condition").length,
      dialectPromptSize: getDialectDictionaryForPrompt().length,
    },
    dialectByCategory: stats.dialectByCategory,
    safetyRuleIds: stats.safetyRuleIds,
    healthGroups: {
      allergy: allergyGroups.map((group) => ({
        title: group.title,
        count: group.items.length,
      })),
      condition: conditionGroups.map((group) => ({
        title: group.title,
        count: group.items.length,
      })),
      coverage: {
        allergy: `${groupedAllergyCount}/${getHealthTerms("allergy").length}`,
        condition: `${groupedConditionCount}/${getHealthTerms("condition").length}`,
      },
    },
    search: {
      question,
      language,
      conditionLabels,
      dialectHints: knowledge.dialectHints,
      foodAliasHints: knowledge.foodAliasHints,
      dishNameHints: knowledge.dishNameHints.map((item) => ({
        name: item.name,
        variantCount: item.variant_count,
      })),
      recipes: knowledge.recipes.map((item) => item.standard_name),
      globalDishes: knowledge.globalDishes.map((item) => item.standard_name),
      foods: knowledge.foods.map((item) => ({
        name: item.standard_name,
        cautionDiseases: item.disease_info?.caution_diseases ?? [],
      })),
      safetyRules: knowledge.safetyRules.map((rule) => rule.id),
      riskFloorHits: knowledge.riskFloorHits,
    },
    translationChecks: [
      { input: "고지혈증", en: localizeDiseaseName("고지혈증", "en-US"), ja: localizeDiseaseName("고지혈증", "ja-JP") },
      {
        input: "통풍 (내장/껍질 섭취 시)",
        en: localizeDiseaseName("통풍 (내장/껍질 섭취 시)", "en-US"),
        ja: localizeDiseaseName("통풍 (내장/껍질 섭취 시)", "ja-JP"),
      },
      { input: "존재하지않는병", en: localizeDiseaseName("존재하지않는병", "en-US"), ja: localizeDiseaseName("존재하지않는병", "ja-JP") },
    ],
    resolveChecks: [
      { input: "고지혈증", id: resolveHealthTermId("condition", "고지혈증") },
      { input: "Hyperlipidemia", id: resolveHealthTermId("condition", "Hyperlipidemia") },
      { input: "高脂血症", id: resolveHealthTermId("condition", "高脂血症") },
      { input: "새우", id: resolveHealthTermId("allergy", "새우") },
      { input: "Shrimp", id: resolveHealthTermId("allergy", "Shrimp") },
    ],
    frequentConditionChecks: [
      { input: "치은염및치주질환", matched: matchFrequentCondition("치은염및치주질환")?.name ?? null },
      { input: "무릎관절증", matched: matchFrequentCondition("무릎관절증")?.name ?? null },
      { input: "존재하지않는병", matched: matchFrequentCondition("존재하지않는병")?.name ?? null },
    ],
  });
}
