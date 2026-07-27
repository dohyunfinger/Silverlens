import dialectTerms from "../../data/dialect_terms.json";
import foodAliases from "../../data/food_aliases.json";
import safetyRules from "../../data/safety_rules.json";

export type KnowledgeData = {
  dialectTerms: typeof dialectTerms;
  foodAliases: typeof foodAliases;
  safetyRules: typeof safetyRules;
};

let memoryCache: KnowledgeData | null = null;

export function loadKnowledgeData(): KnowledgeData {
  if (!memoryCache) {
    memoryCache = { dialectTerms, foodAliases, safetyRules };
  }
  return memoryCache;
}
