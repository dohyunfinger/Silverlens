import dialectTerms from "../../data/dialect_terms.json";
import dialectDictionary from "../../data/dialect_dictionary.json";
import foodAliases from "../../data/food_aliases.json";
import foodIngredients from "../../data/food_ingredient.json";
import safetyRules from "../../data/safety_rules.json";
import seniorFoodKnowledge from "../../data/senior_food_knowledge.json";

type DialectDictionaryEntry = {
  dialect: string;
  standard: string;
  region: string;
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
  dialectTerms: typeof dialectTerms;
  dialectDictionary: DialectDictionaryEntry[];
  foodAliases: typeof foodAliases;
  foodIngredients: RecipeRecord[];
  safetyRules: typeof safetyRules;
  seniorFoodKnowledge: SeniorFoodRecord[];
};

let memoryCache: KnowledgeData | null = null;

export function loadKnowledgeData(): KnowledgeData {
  if (!memoryCache) {
    memoryCache = {
      dialectTerms,
      dialectDictionary,
      foodAliases,
      foodIngredients,
      safetyRules,
      seniorFoodKnowledge,
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

function recordText(record: RecipeRecord | SeniorFoodRecord) {
  const dialects = Object.values(record.dialects ?? {}).flat();
  const recipeIngredients =
    "ingredients" in record && Array.isArray(record.ingredients)
      ? record.ingredients
      : [];
  const diseaseInfo =
    "disease_info" in record ? record.disease_info : undefined;

  return normalized(
    [
      record.standard_name,
      record.category ?? "",
      ...dialects,
      ...recipeIngredients,
      ...(diseaseInfo?.caution_diseases ?? []),
      diseaseInfo?.good_compatibility ?? "",
      diseaseInfo?.bad_compatibility ?? "",
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

export function findRelevantKnowledge(
  question: string,
  profile: { allergies?: string[]; conditions?: string[] } = {},
) {
  const knowledge = loadKnowledgeData();
  const searchQuery = [
    question,
    ...(profile.allergies ?? []),
    ...(profile.conditions ?? []),
  ].join(" ");

  return {
    dialectHints: dictionaryMatches(question, knowledge.dialectDictionary),
    recipes: rankedMatches(knowledge.foodIngredients, searchQuery, 4),
    foods: rankedMatches(knowledge.seniorFoodKnowledge, searchQuery, 4),
    foodAliases: knowledge.foodAliases,
    legacyDialectTerms: knowledge.dialectTerms,
    safetyRules: knowledge.safetyRules,
  };
}

export function getDialectDictionaryForPrompt(limit = 205) {
  return loadKnowledgeData().dialectDictionary.slice(0, limit);
}
