import diseaseI18nJson from "../../data/disease_i18n.json";
import frequentConditionsJson from "../../data/senior_frequent_conditions.json";
import { toHealthLanguage, type HealthLanguage } from "./healthTerms";

export type DiseaseI18nEntry = {
  ko: string;
  en: string;
  ja: string;
  ja_romaji: string;
};

export type FrequentCondition = {
  /** 읽기 쉽게 공백을 넣은 상병명. 예) "치은염 및 치주질환" */
  name: string;
  /** 통계 원본 표기. 예) "치은염및치주질환" */
  raw: string;
};

const diseaseI18n = diseaseI18nJson as DiseaseI18nEntry[];
const frequentConditions = frequentConditionsJson as FrequentCondition[];

function normalizeKey(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[\s'’"“”.,/#!$%^&*;:{}=_`~()[\]]+/g, "");
}

/**
 * "통풍 (내장/껍질 섭취 시)" 처럼 조건이 붙은 표기에서 핵심 질병명만 떼어 낸다.
 * 괄호 안 설명은 번역 대상에서 제외하되 결과 문구에는 그대로 남긴다.
 */
function splitDiseaseLabel(value: string) {
  const match = value.match(/^([^(（]+)([(（].*)?$/);
  const core = (match?.[1] ?? value).trim();
  const suffix = (match?.[2] ?? "").trim();
  return { core, suffix };
}

const byKoreanKey = new Map<string, DiseaseI18nEntry>();
for (const entry of diseaseI18n) {
  const key = normalizeKey(entry.ko);
  if (key && !byKoreanKey.has(key)) byKoreanKey.set(key, entry);
}

const frequentConditionKeys = new Map<string, FrequentCondition>();
for (const condition of frequentConditions) {
  for (const candidate of [condition.name, condition.raw]) {
    const key = normalizeKey(candidate);
    if (key && !frequentConditionKeys.has(key)) {
      frequentConditionKeys.set(key, condition);
    }
  }
}

export function getDiseaseI18nEntries() {
  return diseaseI18n;
}

export function findDiseaseI18n(koreanName: string) {
  const { core } = splitDiseaseLabel(koreanName);
  return byKoreanKey.get(normalizeKey(core)) ?? byKoreanKey.get(normalizeKey(koreanName)) ?? null;
}

/**
 * 한국어 질병명을 화면 언어로 바꾼다.
 * 대응표에 없으면 한국어를 그대로 돌려주어 정보가 사라지지 않게 한다.
 */
export function localizeDiseaseName(koreanName: string, language?: string) {
  const selected: HealthLanguage = toHealthLanguage(language);
  if (selected === "ko-KR") return koreanName;

  const { core, suffix } = splitDiseaseLabel(koreanName);
  const entry = findDiseaseI18n(core);
  if (!entry) return koreanName;

  const translated = selected === "en-US" ? entry.en : entry.ja;
  if (!translated) return koreanName;
  return suffix ? `${translated} ${suffix}` : translated;
}

export function localizeDiseaseNames(koreanNames: string[], language?: string) {
  return koreanNames.map((name) => localizeDiseaseName(name, language));
}

/** 한국어 질병명에 대해 검색용 별칭(영어·일본어·로마자)을 모두 돌려준다. */
export function getDiseaseAliases(koreanName: string) {
  const entry = findDiseaseI18n(koreanName);
  if (!entry) return [];
  return [entry.en, entry.ja, entry.ja_romaji].filter(
    (value): value is string => Boolean(value && value.trim()),
  );
}

export function getSeniorFrequentConditions() {
  return frequentConditions;
}

/**
 * 사용자가 직접 입력한 질병명이 노인 다빈도 상병 목록에 있으면 정식 표기를 돌려준다.
 * health_terms.json 에 없는 질병을 프로필에 남길 때 표기를 일관되게 만드는 용도다.
 */
export function matchFrequentCondition(value: string) {
  const key = normalizeKey(value);
  if (!key) return null;
  const exact = frequentConditionKeys.get(key);
  if (exact) return exact;
  return (
    frequentConditions.find((condition) => {
      const candidate = normalizeKey(condition.raw);
      return candidate.length >= 3 && (candidate.includes(key) || key.includes(candidate));
    }) ?? null
  );
}
