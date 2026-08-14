import dialectDictionary from "../../data/dialect_dictionary.json";
import drugIdentificationReference from "../../data/drug_identification_reference.json";
import foodAliases from "../../data/food_aliases.json";
import globalDishNames from "../../data/global_dish_names.json";
import koreanDishNames from "../../data/korean_dish_names.json";
import mfdsPillIdentification from "../../data/mfds_pill_identification.json";
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

export type PillObservation = {
  productText?: string;
  manufacturerText?: string;
  imprintFront?: string;
  imprintBack?: string;
  dosageForm?: string;
  shape?: string;
  colorFront?: string;
  colorBack?: string;
  scoreLineFront?: string;
  scoreLineBack?: string;
};

export type PillIdentificationRecord = {
  itemSeq: string;
  itemName: string;
  manufacturer: string;
  description: string;
  imageUrl: string;
  imprintFront: string;
  imprintBack: string;
  shape: string;
  colorFront: string;
  colorBack: string;
  scoreLineFront: string;
  scoreLineBack: string;
  lengthLong: string;
  lengthShort: string;
  thickness: string;
  className: string;
  otcType: string;
  dosageForm: string;
  englishName: string;
  standardCode: string;
};

type DrugIdentificationReference = typeof drugIdentificationReference;

type PillIdentificationCatalog = {
  metadata: {
    source: string;
    source_url: string;
    license: string;
    synced_at: string | null;
    note: string;
  };
  records: PillIdentificationRecord[];
};

export type PillCandidate = PillIdentificationRecord & {
  matchScore: number;
  matchedBy: string[];
};

export type RiskLevelName = "danger" | "caution" | "safe";

export type SafetyRule = {
  id: string;
  severity: string;
  applies_to: string[];
  /** health_terms.json 의 질병 ID. 문자열 대조보다 정확해서 이쪽을 먼저 본다. */
  condition_ids: string[];
  /** 질문에 이 식품이 등장하면 규칙이 실제로 걸린 것으로 본다. */
  food_triggers: string[];
  /** 질병과 식품이 함께 걸렸을 때 보장할 최소 위험도. null이면 하한선 없음. */
  risk_floor: RiskLevelName | null;
  rule: string;
  detail?: string;
};

/** 질병 + 위험 식품이 함께 걸려 위험도 하한선이 생긴 근거. */
export type RiskFloorHit = {
  ruleId: string;
  floor: RiskLevelName;
  matchedFoods: string[];
  rule: string;
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
  /**
   * 외국 음식 사전. 한식 요리 사전과 뜻이 겹치지 않도록 파일과 배열을 따로 둔다.
   * 어르신에게는 낯선 이름이라 프롬프트에서도 "쉬운 우리말로 풀어 달라"는
   * 지시와 함께 별도 항목으로 넘긴다.
   */
  globalDishes: RecipeRecord[];
  safetyRules: SafetyRule[];
  seniorFoodKnowledge: SeniorFoodRecord[];
  koreanDishNames: KoreanDishName[];
  drugIdentificationReference: DrugIdentificationReference;
  pillIdentification: PillIdentificationCatalog;
};

let memoryCache: KnowledgeData | null = null;

export function loadKnowledgeData(): KnowledgeData {
  if (!memoryCache) {
    memoryCache = {
      dialectDictionary: dialectDictionary as DialectDictionaryEntry[],
      foodAliases: foodAliases as FoodAlias[],
      recipes: recipes as RecipeRecord[],
      globalDishes: globalDishNames as RecipeRecord[],
      safetyRules: safetyRules as SafetyRule[],
      seniorFoodKnowledge: seniorFoodKnowledge as SeniorFoodRecord[],
      koreanDishNames: koreanDishNames as KoreanDishName[],
      drugIdentificationReference,
      pillIdentification: mfdsPillIdentification as PillIdentificationCatalog,
    };
  }
  return memoryCache;
}

export function normalizedDrugText(value: string | undefined) {
  return (value ?? "")
    .normalize("NFKC")
    .toLocaleUpperCase("ko-KR")
    .replace(/[^0-9A-Z가-힣]/g, "");
}

function scoreDrugText(
  observed: string | undefined,
  candidate: string,
  exactScore: number,
  partialScore: number,
) {
  const left = normalizedDrugText(observed);
  const right = normalizedDrugText(candidate);
  if (left.length < 2 || right.length < 2) return 0;
  if (left === right) return exactScore;
  if (left.includes(right) || right.includes(left)) return partialScore;
  return 0;
}

/**
 * 사진에서 읽은 글자·각인을 식약처 낱알식별 데이터와 대조한다.
 * 색과 모양은 서로 다른 약에서도 반복되므로, 제품명 또는 각인이 먼저 맞은
 * 경우에만 보조 점수로 쓴다. 이 함수의 결과도 확정 판정이 아니라 후보이다.
 */
export function findPillCandidates(
  observation: PillObservation | null | undefined,
  limit = 5,
): PillCandidate[] {
  if (!observation) return [];

  const catalog = loadKnowledgeData().pillIdentification.records;
  return rankPillCandidates(observation, catalog, limit);
}

/** D1 또는 로컬 JSON에서 가져온 공식 품목을 같은 안전 기준으로 정렬한다. */
export function rankPillCandidates(
  observation: PillObservation | null | undefined,
  records: readonly PillIdentificationRecord[],
  limit = 5,
): PillCandidate[] {
  if (!observation) return [];

  return records
    .map((record) => {
      const matchedBy: string[] = [];
      let identityScore = 0;

      const productScore = scoreDrugText(
        observation.productText,
        record.itemName,
        100,
        72,
      );
      if (productScore > 0) {
        identityScore += productScore;
        matchedBy.push("제품명");
      }

      const frontScore = Math.max(
        scoreDrugText(observation.imprintFront, record.imprintFront, 62, 44),
        scoreDrugText(observation.imprintFront, record.imprintBack, 48, 34),
      );
      if (frontScore > 0) {
        identityScore += frontScore;
        matchedBy.push("앞면 각인");
      }

      const backScore = Math.max(
        scoreDrugText(observation.imprintBack, record.imprintBack, 58, 42),
        scoreDrugText(observation.imprintBack, record.imprintFront, 46, 32),
      );
      if (backScore > 0) {
        identityScore += backScore;
        matchedBy.push("뒷면 각인");
      }

      // 제품명이나 각인이 전혀 맞지 않으면 색·모양만으로 후보를 만들지 않는다.
      if (identityScore === 0) return null;

      let supportScore = 0;
      const supportingFields: Array<[
        keyof PillObservation,
        keyof PillIdentificationRecord,
        string,
        number,
      ]> = [
        ["manufacturerText", "manufacturer", "제조사", 10],
        ["dosageForm", "dosageForm", "제형", 8],
        ["shape", "shape", "모양", 8],
        ["colorFront", "colorFront", "앞면 색", 5],
        ["colorBack", "colorBack", "뒷면 색", 5],
        ["scoreLineFront", "scoreLineFront", "앞면 분할선", 3],
        ["scoreLineBack", "scoreLineBack", "뒷면 분할선", 3],
      ];
      for (const [observedKey, recordKey, label, score] of supportingFields) {
        const observedValue = normalizedDrugText(observation[observedKey]);
        const recordValue = normalizedDrugText(record[recordKey]);
        if (observedValue && recordValue && observedValue === recordValue) {
          supportScore += score;
          matchedBy.push(label);
        }
      }

      return {
        ...record,
        matchScore: identityScore + supportScore,
        matchedBy,
      };
    })
    .filter((candidate): candidate is PillCandidate => candidate !== null)
    .sort((left, right) => right.matchScore - left.matchScore)
    .slice(0, limit);
}

/** 약 사진을 볼 때 모델에 넘길 검증된 관찰 순서와 안전 원칙. */
export function getDrugIdentificationReferenceForPrompt() {
  const reference = loadKnowledgeData().drugIdentificationReference;
  return {
    source: reference.metadata.sources[0],
    observationFields: reference.observation_fields,
    photoChecklist: reference.photo_checklist,
    decisionRules: reference.decision_rules,
  };
}

export function getPillIdentificationCatalogCount() {
  return loadKnowledgeData().pillIdentification.records.length;
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

const HANGUL_SYLLABLE = /[가-힣]/;

type SearchIndex = {
  /** 공백을 지운 검색용 문자열. "마카로니 샐러드" 같은 이름도 찾을 수 있다. */
  compact: string;
  /** compact 의 같은 자리 문자가 원문에서 무엇 뒤에 있었는지. 낱말 시작 판단용. */
  previous: string[];
};

/**
 * 공백을 지운 검색 문자열과 함께, 각 글자가 원문에서 무엇 뒤에 있었는지 남긴다.
 * 공백을 지우면 낱말 경계가 사라져 "손흥민 어제"에서 '민어'가 걸리기 때문이다.
 */
function buildSearchIndex(text: string): SearchIndex {
  const lower = text.toLocaleLowerCase("ko-KR");
  let compact = "";
  const previous: string[] = [];
  for (let index = 0; index < lower.length; index += 1) {
    const character = lower[index];
    if (/\s/.test(character)) continue;
    previous.push(index > 0 ? lower[index - 1] : "");
    compact += character;
  }
  return { compact, previous };
}

/**
 * 낱말 시작 위치에서만 이름을 인정한다.
 *
 * 한국어는 조사가 뒤에 붙으므로("케밥이", "국수는") 뒤쪽은 막지 않는다.
 * 앞쪽만 막아도 '후무스'의 '무', '손흥민 어제'의 '민어', '아사도'의 '사도'처럼
 * 다른 낱말 안에 파묻힌 우연한 일치를 걸러 낼 수 있다.
 */
function mentionsTerm(index: SearchIndex, term: string) {
  if (!term) return false;
  for (let from = 0; ; ) {
    const at = index.compact.indexOf(term, from);
    if (at < 0) return false;
    if (!HANGUL_SYLLABLE.test(index.previous[at] ?? "")) return true;
    from = at + 1;
  }
}

/**
 * 한식 메뉴명이면서 일상 낱말로도 자주 쓰이는 이름.
 *
 * "산적한 문제가 많아요", "적을 소탕했다", "울면 안 돼요"처럼 음식과 무관한
 * 문장에서 걸려 주제 판정을 열어 버리기 때문에 메뉴명 힌트에서만 제외한다.
 * 실제로 이 음식을 물어볼 때는 "먹어도" 같은 낱말이 함께 오므로 주제 판정은
 * 그대로 통과하고, 요리 사전·시니어 식품 검색도 영향을 받지 않는다.
 */
const AMBIGUOUS_DISH_NAMES = new Set(["산적", "소탕", "다식", "미음", "약식", "울면"]);

/**
 * 질문 안에 한식 메뉴명이 들어 있는지 확인한다.
 * senior_food_knowledge/recipes 에 없는 메뉴라도 "실제로 존재하는 한식"임을
 * 알려 주면 모델이 엉뚱한 식재료로 넘어가는 것을 막을 수 있다.
 *
 * 세 글자 미만은 오탐을 걱정해 통째로 빼 두었는데, 그 바람에 국수·김밥·미역국처럼
 * 시니어 식단에서 흔한 두 글자 메뉴 105개가 한 번도 걸리지 않았다.
 * 지금은 두 글자까지 낱말 경계를 확인해 받아들이고, 한 글자("번")만 제외한다.
 */
function dishNameMatches(query: string, entries: KoreanDishName[], limit = 6) {
  const queryIndex = buildSearchIndex(query);
  const matched = entries.filter((entry) => {
    const name = normalized(entry.name);
    // "번역", "번호"처럼 흔한 낱말의 첫 글자와 겹치는 한 글자 이름은 제외한다.
    // 목록에 있는 한 글자 이름은 '번' 하나뿐이라 잃는 것이 없다.
    if (name.length < 2) return false;
    if (AMBIGUOUS_DISH_NAMES.has(name)) return false;
    return mentionsTerm(queryIndex, name);
  });
  return matched
    .sort((left, right) => right.name.length - left.name.length)
    .slice(0, limit);
}

/**
 * 검색용 문자열. 낱말 경계를 볼 수 있게 공백은 남겨 둔다.
 *
 * 예전에는 공백까지 지운 한 덩어리였는데, 그래서 "주식 사도 될까요?"의 '사도'가
 * '아사도' 안에서 걸리고 "손흥민 어제 골"에서 '민어'가 걸렸다.
 */
function recordText(record: RecipeRecord | SeniorFoodRecord) {
  const dialects = Object.values(record.dialects ?? {}).flat();
  const recipeIngredients =
    "ingredients" in record && Array.isArray(record.ingredients)
      ? record.ingredients
      : [];

  return [
    record.standard_name,
    record.category ?? "",
    ...dialects,
    ...recipeIngredients,
  ]
    .join(" ")
    .toLocaleLowerCase("ko-KR");
}

function scoreRecord(
  record: RecipeRecord | SeniorFoodRecord,
  queryIndex: SearchIndex,
  tokens: string[],
) {
  const searchIndex = buildSearchIndex(recordText(record));
  const name = normalized(record.standard_name);
  let score = 0;

  if (mentionsTerm(queryIndex, name)) score += 20;
  for (const token of tokens) {
    if (token === name) score += 12;
    else if (mentionsTerm(searchIndex, token)) score += 3;
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
  const queryIndex = buildSearchIndex(query);

  // 자료에 같은 이름이 두 번 들어간 항목이 있어(예: 제육볶음, 민어) 검색 결과가
  // 같은 음식으로 채워지는 일이 있었다. 프롬프트에 넣을 자리는 네 개뿐이라
  // 이름이 겹치면 점수가 높은 쪽만 남긴다.
  const seen = new Set<string>();
  return records
    .map((record) => ({ record, score: scoreRecord(record, queryIndex, tokens) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)
    .filter((item) => {
      const key = normalized(item.record.standard_name);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
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

const RISK_ORDER: Record<RiskLevelName, number> = {
  safe: 0,
  caution: 1,
  danger: 2,
};

export function higherRisk(
  left: RiskLevelName,
  right: RiskLevelName,
): RiskLevelName {
  return RISK_ORDER[left] >= RISK_ORDER[right] ? left : right;
}

/**
 * 규칙이 사용자 질병에 해당하는지 본다.
 *
 * 예전에는 applies_to 문자열을 대조했는데, 규칙에 "만성 신장질환"이라 적고
 * 화면 표시명은 "신장질환"이어서 신장 규칙이 한 번도 걸리지 않았다.
 * 그래서 health_terms ID 대조를 먼저 하고, ID가 없는 경우에만 문자열로 돕는다.
 */
function ruleMatchesConditions(
  rule: SafetyRule,
  conditionIds: string[],
  conditionLabels: string[],
) {
  if (rule.condition_ids.length > 0) {
    if (rule.condition_ids.some((id) => conditionIds.includes(id))) return true;
  }
  if (conditionLabels.length === 0) return false;

  const labels = conditionLabels.map(normalized);
  return rule.applies_to.some((target) => {
    const candidate = normalized(target);
    if (candidate.length < 2) return false;
    // 표기가 서로 조금 달라도 한쪽이 다른 쪽을 포함하면 같은 질병으로 본다.
    return labels.some(
      (label) => label.includes(candidate) || candidate.includes(label),
    );
  });
}

/**
 * 사용자가 등록한 질병과 관련된 안전 원칙만 골라 낸다.
 * "전체" 규칙은 항상 포함하고, 질병별 규칙은 등록 질병과 겹칠 때만 넣는다.
 */
function relevantSafetyRules(
  rules: SafetyRule[],
  conditionIds: string[],
  conditionLabels: string[],
) {
  return rules.filter((rule) => {
    if (rule.applies_to.includes("전체")) return true;
    return ruleMatchesConditions(rule, conditionIds, conditionLabels);
  });
}

/**
 * 위험도 하한선을 계산한다.
 *
 * 질병만 걸려도 하한선을 주면 과경보가 된다(신장질환자가 두부를 물어도 위험).
 * 그래서 질병과 위험 식품이 **함께** 걸렸을 때만 하한선을 만든다.
 * 모델이 판정을 낮게 주더라도 화면에는 이 값 이상이 표시된다.
 */
function riskFloorHits(
  rules: SafetyRule[],
  question: string,
  conditionIds: string[],
  conditionLabels: string[],
): RiskFloorHit[] {
  const normalizedQuestion = normalized(question);
  const hits: RiskFloorHit[] = [];

  for (const rule of rules) {
    if (!rule.risk_floor || rule.food_triggers.length === 0) continue;
    if (!ruleMatchesConditions(rule, conditionIds, conditionLabels)) continue;

    const matchedFoods = rule.food_triggers.filter((food) => {
      const candidate = normalized(food);
      return candidate.length >= 2 && normalizedQuestion.includes(candidate);
    });
    if (matchedFoods.length === 0) continue;

    hits.push({
      ruleId: rule.id,
      floor: rule.risk_floor,
      matchedFoods,
      rule: rule.rule,
    });
  }

  return hits;
}

export function findRelevantKnowledge(
  question: string,
  options: {
    language?: string;
    conditionLabels?: string[];
    conditionIds?: string[];
  } = {},
) {
  const knowledge = loadKnowledgeData();
  const { language, conditionLabels = [], conditionIds = [] } = options;
  const safetyRules = relevantSafetyRules(
    knowledge.safetyRules,
    conditionIds,
    conditionLabels,
  );

  const matchedRecipes = rankedMatches(knowledge.recipes, question, 4);
  // 도넛처럼 두 사전에 다 있는 음식은 재료 목록이 서로 달라서, 둘 다 넘기면
  // 모델이 어느 쪽을 따라야 할지 헷갈린다. 파일은 그대로 두고 검색 결과에서만
  // 한식 요리 사전을 우선해 겹치는 이름을 뺀다.
  const matchedRecipeNames = new Set(
    matchedRecipes.map((record) => normalized(record.standard_name)),
  );
  const matchedGlobalDishes = rankedMatches(knowledge.globalDishes, question, 3).filter(
    (record) => !matchedRecipeNames.has(normalized(record.standard_name)),
  );

  return {
    dialectHints: dictionaryMatches(question, knowledge.dialectDictionary),
    foodAliasHints: aliasMatches(question, knowledge.foodAliases),
    dishNameHints: dishNameMatches(question, knowledge.koreanDishNames),
    recipes: matchedRecipes,
    globalDishes: matchedGlobalDishes,
    foods: rankedMatches(knowledge.seniorFoodKnowledge, question, 4).map((record) =>
      localizeSeniorFoodRecord(record, language),
    ),
    safetyRules,
    riskFloorHits: riskFloorHits(
      knowledge.safetyRules,
      question,
      conditionIds,
      conditionLabels,
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
      globalDishes: knowledge.globalDishes.length,
      safetyRules: knowledge.safetyRules.length,
      seniorFoodKnowledge: knowledge.seniorFoodKnowledge.length,
      pillIdentification: knowledge.pillIdentification.records.length,
    },
    dialectByCategory,
    dialectSample: knowledge.dialectDictionary.slice(0, 3),
    safetyRuleIds: knowledge.safetyRules.map((rule) => rule.id),
  };
}
