import dialectDictionary from "../../data/dialect_dictionary.json";
import foodAliases from "../../data/food_aliases.json";
import koreanDishNames from "../../data/korean_dish_names.json";
import recipes from "../../data/recipes.json";
import safetyRules from "../../data/safety_rules.json";
import seniorFoodKnowledge from "../../data/senior_food_knowledge.json";
import { localizeDiseaseNames } from "./diseaseI18n";

export type DialectCategory = "식재료" | "음식" | "신체증상" | "생활";

export type DialectDictionaryEntry = {
  dialect: string;
  standard: string;
  region: string;
  category: DialectCategory;
};

export type FoodAlias = {
  alias: string;
  standard: string;
  kind: string;
};

export type KoreanDishName = {
  name: string;
  /** 프롬프트에 넣을 대표 부재료 예시. 원본 조합 수는 variant_count 로 따로 둔다. */
  variants: string[];
  variant_count: number;
};

export type SafetyRule = {
  id: string;
  severity: string;
  applies_to: string[];
  rule: string;
  detail?: string;
};

type RecipeRecord = {
  id: number;
  standard_name: string;
  category?: string;
  dialects?: Record<string, string[]>;
  ingredients?: string[];
};

type DiseaseInfo = {
  caution_diseases?: string[];
  caution_reason?: string;
  good_compatibility?: string;
  bad_compatibility?: string;
};

type SeniorFoodRecord = {
  id: number;
  category?: string;
  standard_name: string;
  dialects?: Record<string, string[]>;
  daily_recommended_amount?: string;
  elderly_friendly_guide?: string;
  disease_info?: DiseaseInfo;
};

export type KnowledgeData = {
  dialectDictionary: DialectDictionaryEntry[];
  foodAliases: FoodAlias[];
  recipes: RecipeRecord[];
  safetyRules: SafetyRule[];
  seniorFoodKnowledge: SeniorFoodRecord[];
  koreanDishNames: KoreanDishName[];
};

let memoryCache: KnowledgeData | null = null;

export function loadKnowledgeData(): KnowledgeData {
  if (!memoryCache) {
    memoryCache = {
      dialectDictionary: dialectDictionary as DialectDictionaryEntry[],
      foodAliases: foodAliases as FoodAlias[],
      recipes: recipes as RecipeRecord[],
      safetyRules: safetyRules as SafetyRule[],
      seniorFoodKnowledge: seniorFoodKnowledge as SeniorFoodRecord[],
      koreanDishNames: koreanDishNames as KoreanDishName[],
    };
  }
  return memoryCache;
}

function normalized(value: string) {
  return value.toLocaleLowerCase("ko-KR").replace(/\s+/g, "");
}

function dictionaryMatches(
  query: string,
  entries: DialectDictionaryEntry[],
  limit = 20,
) {
  const normalizedQuery = normalized(query);
  return entries
    .filter((entry) => {
      const dialect = normalized(entry.dialect);
      return dialect.length >= 2 && normalizedQuery.includes(dialect);
    })
    .slice(0, limit);
}

function aliasMatches(query: string, entries: FoodAlias[], limit = 8) {
  const normalizedQuery = normalized(query);
  return entries
    .filter((entry) => {
      const alias = normalized(entry.alias);
      return alias.length >= 2 && normalizedQuery.includes(alias);
    })
    .slice(0, limit);
}

/**
 * 질문 안에 한식 메뉴명이 들어 있는지 확인한다.
 * senior_food_knowledge/recipes 에 없는 메뉴라도 "실제로 존재하는 한식"임을
 * 알려 주면 모델이 엉뚱한 식재료로 넘어가는 것을 막을 수 있다.
 */
function dishNameMatches(query: string, entries: KoreanDishName[], limit = 6) {
  const normalizedQuery = normalized(query);
  const matched = entries.filter((entry) => {
    const name = normalized(entry.name);
    return name.length >= 3 && normalizedQuery.includes(name);
  });
  return matched
    .sort((left, right) => right.name.length - left.name.length)
    .slice(0, limit);
}

function recordText(record: RecipeRecord | SeniorFoodRecord) {
  const dialects = Object.values(record.dialects ?? {}).flat();
  const recipeIngredients =
    "ingredients" in record && Array.isArray(record.ingredients)
      ? record.ingredients
      : [];

  return normalized(
    [
      record.standard_name,
      record.category ?? "",
      ...dialects,
      ...recipeIngredients,
    ].join(" "),
  );
}

function scoreRecord(
  record: RecipeRecord | SeniorFoodRecord,
  query: string,
  tokens: string[],
) {
  const searchable = recordText(record);
  const normalizedQuery = normalized(query);
  const name = normalized(record.standard_name);
  let score = 0;

  if (normalizedQuery.includes(name)) score += 20;
  for (const token of tokens) {
    if (token === name) score += 12;
    else if (searchable.includes(token)) score += 3;
  }
  return score;
}

function rankedMatches<T extends RecipeRecord | SeniorFoodRecord>(
  records: T[],
  query: string,
  limit: number,
) {
  const tokens = [...new Set(
    query
      .split(/[\s,./?!()[\]{}:;'"·]+/)
      .map(normalized)
      .filter((token) => token.length >= 2),
  )];

  return records
    .map((record) => ({ record, score: scoreRecord(record, query, tokens) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map((item) => item.record);
}

/**
 * 시니어 식품 기록의 주의 질병명을 화면 언어로 번역해 둔다.
 * 원본 데이터는 한국어 질병명만 갖고 있어서 영어·일본어 화면에서도
 * 한국어가 그대로 노출되던 문제를 여기서 막는다.
 */
function localizeSeniorFoodRecord(
  record: SeniorFoodRecord,
  language?: string,
): SeniorFoodRecord {
  const cautionDiseases = record.disease_info?.caution_diseases;
  if (!cautionDiseases?.length) return record;
  return {
    ...record,
    disease_info: {
      ...record.disease_info,
      caution_diseases: localizeDiseaseNames(cautionDiseases, language),
    },
  };
}

/**
 * 사용자가 등록한 질병과 관련된 안전 원칙만 골라 낸다.
 * "전체" 규칙은 항상 포함하고, 질병별 규칙은 등록 질병과 겹칠 때만 넣는다.
 */
function relevantSafetyRules(
  rules: SafetyRule[],
  conditionLabels: string[],
  question: string,
) {
  const haystack = normalized([question, ...conditionLabels].join(" "));
  return rules.filter((rule) => {
    if (rule.applies_to.includes("전체")) return true;
    return rule.applies_to.some((target) => {
      const candidate = normalized(target);
      return candidate.length >= 2 && haystack.includes(candidate);
    });
  });
}

export function findRelevantKnowledge(
  question: string,
  options: { language?: string; conditionLabels?: string[] } = {},
) {
  const knowledge = loadKnowledgeData();
  const { language, conditionLabels = [] } = options;

  return {
    dialectHints: dictionaryMatches(question, knowledge.dialectDictionary),
    foodAliasHints: aliasMatches(question, knowledge.foodAliases),
    dishNameHints: dishNameMatches(question, knowledge.koreanDishNames),
    recipes: rankedMatches(knowledge.recipes, question, 4),
    foods: rankedMatches(knowledge.seniorFoodKnowledge, question, 4).map((record) =>
      localizeSeniorFoodRecord(record, language),
    ),
    safetyRules: relevantSafetyRules(
      knowledge.safetyRules,
      conditionLabels,
      question,
    ),
  };
}

/**
 * 음성 인식 프롬프트에 넣을 방언 사전.
 * 식재료·음식·신체증상 항목을 먼저 넣어 건강 대화에서 중요한 어휘가
 * 잘려 나가지 않게 정렬한다.
 */
export function getDialectDictionaryForPrompt(limit = 260) {
  const priority: Record<DialectCategory, number> = {
    식재료: 0,
    음식: 1,
    신체증상: 2,
    생활: 3,
  };
  return [...loadKnowledgeData().dialectDictionary]
    .sort((left, right) => priority[left.category] - priority[right.category])
    .slice(0, limit);
}

export function getFoodAliasesForPrompt() {
  return loadKnowledgeData().foodAliases;
}

/** 임시 로그 화면에서 데이터가 실제로 붙었는지 확인하는 용도. */
export function getKnowledgeStats() {
  const knowledge = loadKnowledgeData();
  const dialectByCategory = knowledge.dialectDictionary.reduce<
    Record<string, number>
  >((acc, entry) => {
    acc[entry.category] = (acc[entry.category] ?? 0) + 1;
    return acc;
  }, {});

  return {
    counts: {
      dialectDictionary: knowledge.dialectDictionary.length,
      foodAliases: knowledge.foodAliases.length,
      koreanDishNames: knowledge.koreanDishNames.length,
      recipes: knowledge.recipes.length,
      safetyRules: knowledge.safetyRules.length,
      seniorFoodKnowledge: knowledge.seniorFoodKnowledge.length,
    },
    dialectByCategory,
    dialectSample: knowledge.dialectDictionary.slice(0, 3),
    safetyRuleIds: knowledge.safetyRules.map((rule) => rule.id),
  };
}
