import diseaseI18nJson from "../../data/disease_i18n.json";
import healthGroupsJson from "../../data/health_groups.json";
import healthTermsJson from "../../data/health_terms.json";

export type HealthLanguage = "ko-KR" | "en-US" | "ja-JP";
export type HealthKind = "allergy" | "condition";

export type HealthTerm = {
  id: string;
  kind: HealthKind;
  labels: Record<HealthLanguage, string>;
  aliases: string[];
};

const healthTerms = healthTermsJson as HealthTerm[];
const supportedLanguages: HealthLanguage[] = ["ko-KR", "en-US", "ja-JP"];

function normalize(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[\s'’"“”.,/#!$%^&*;:{}=_`~()]+/g, "");
}

/**
 * data/disease_i18n.json 의 질병명 한국어→영어·일본어 대응표로 검색 별칭을 보강한다.
 * health_terms.json 의 aliases 에 영어·일본어 표기가 빠져 있어도
 * 어르신이나 가족이 다른 언어로 입력했을 때 같은 항목으로 이어진다.
 */
const diseaseAliasIndex = new Map<string, string[]>();
for (const entry of diseaseI18nJson as Array<{
  ko: string;
  en: string;
  ja: string;
  ja_romaji: string;
}>) {
  const key = normalize(entry.ko);
  if (!key) continue;
  const aliases = [entry.ko, entry.en, entry.ja, entry.ja_romaji].filter(
    (value): value is string => Boolean(value && value.trim()),
  );
  diseaseAliasIndex.set(key, [...(diseaseAliasIndex.get(key) ?? []), ...aliases]);
}

/**
 * "고지혈증 (이상지질혈증)" 처럼 괄호로 부연 설명이 붙은 표시명에서 핵심 이름만 뗀다.
 * 어르신이 "고지혈증"이라고만 말해도 같은 항목으로 이어져야 한다.
 */
function stripParenthetical(value: string) {
  return value.replace(/[(（][^)）]*[)）]/g, " ").replace(/\s+/g, " ").trim();
}

function searchableCandidates(term: HealthTerm) {
  const labels = Object.values(term.labels);
  const coreLabels = labels.map(stripParenthetical).filter(Boolean);
  const extra = [...labels, ...coreLabels].flatMap(
    (label) => diseaseAliasIndex.get(normalize(label)) ?? [],
  );
  return [term.id, ...labels, ...coreLabels, ...term.aliases, ...extra];
}

export function toHealthLanguage(language?: string): HealthLanguage {
  return supportedLanguages.includes(language as HealthLanguage)
    ? (language as HealthLanguage)
    : "ko-KR";
}

export function getHealthTerms(kind?: HealthKind) {
  return kind ? healthTerms.filter((term) => term.kind === kind) : healthTerms;
}

export function getHealthTerm(id: string) {
  return healthTerms.find((term) => term.id === id);
}

export function getHealthLabel(id: string, language?: string) {
  if (id.startsWith("custom:")) {
    try {
      return decodeURIComponent(id.slice("custom:".length));
    } catch {
      return id.slice("custom:".length);
    }
  }
  const term = getHealthTerm(id);
  return term?.labels[toHealthLanguage(language)] ?? id;
}

export function getHealthOptions(kind: HealthKind, language?: string) {
  const selectedLanguage = toHealthLanguage(language);
  return getHealthTerms(kind).map((term) => ({
    id: term.id,
    label: term.labels[selectedLanguage],
  }));
}

export type HealthGroup = {
  id: string;
  kind: HealthKind;
  icon: string;
  labels: Record<HealthLanguage, string>;
  members: string[];
};

export type HealthGroupOptions = {
  id: string;
  icon: string;
  title: string;
  items: Array<{ id: string; label: string }>;
};

const healthGroups = healthGroupsJson as HealthGroup[];

const ungroupedLabels: Record<HealthLanguage, string> = {
  "ko-KR": "그 밖의 항목",
  "en-US": "Other items",
  "ja-JP": "その他",
};

/**
 * 알레르기·질병 목록을 성격이 비슷한 타이틀로 묶어 돌려준다.
 * 항목이 90개 가까이 되어 한 줄 목록으로는 어르신이 훑기 어렵기 때문에
 * data/health_groups.json 의 묶음 순서대로 화면에 내보낸다.
 * 묶음에 빠진 항목이 생기면 "그 밖의 항목"으로 모아 화면에서 사라지지 않게 한다.
 */
export function getHealthGroupOptions(
  kind: HealthKind,
  language?: string,
): HealthGroupOptions[] {
  const selectedLanguage = toHealthLanguage(language);
  const terms = getHealthTerms(kind);
  const byId = new Map(terms.map((term) => [term.id, term]));
  const used = new Set<string>();
  const groups: HealthGroupOptions[] = [];

  for (const group of healthGroups) {
    if (group.kind !== kind) continue;
    const items = group.members
      .map((memberId) => byId.get(memberId))
      .filter((term): term is HealthTerm => Boolean(term))
      .map((term) => {
        used.add(term.id);
        return { id: term.id, label: term.labels[selectedLanguage] };
      });
    if (items.length === 0) continue;
    groups.push({
      id: group.id,
      icon: group.icon,
      title: group.labels[selectedLanguage],
      items,
    });
  }

  const leftovers = terms
    .filter((term) => !used.has(term.id))
    .map((term) => ({ id: term.id, label: term.labels[selectedLanguage] }));
  if (leftovers.length > 0) {
    groups.push({
      id: `group_${kind}_other`,
      icon: "📋",
      title: ungroupedLabels[selectedLanguage],
      items: leftovers,
    });
  }

  return groups;
}

export function resolveHealthTermId(kind: HealthKind, value: string) {
  const target = normalize(value);
  if (!target) return null;
  const match = getHealthTerms(kind).find((term) =>
    searchableCandidates(term).some((candidate) => normalize(candidate) === target),
  );
  return match?.id ?? null;
}

export function makeStoredHealthId(kind: HealthKind, value: string) {
  return resolveHealthTermId(kind, value) ?? `custom:${encodeURIComponent(value.trim())}`;
}

export function isHealthTermId(kind: HealthKind, value: unknown): value is string {
  return (
    typeof value === "string" &&
    getHealthTerms(kind).some((term) => term.id === value)
  );
}

export function getHealthCatalogForPrompt() {
  return healthTerms.map((term) => ({
    id: term.id,
    kind: term.kind,
    labels: term.labels,
    aliases: term.aliases,
  }));
}

export function findAllergyTermConflicts(text: string, allergyIds: string[]) {
  const normalizedText = normalize(text);
  return allergyIds
    .map((id) => getHealthTerm(id))
    .filter((term): term is HealthTerm => Boolean(term && term.kind === "allergy"))
    .filter((term) =>
      [
        ...Object.values(term.labels),
        ...Object.values(term.labels).map(stripParenthetical),
        ...term.aliases,
      ].some((candidate) => {
        const normalizedCandidate = normalize(candidate);
        return (
          normalizedCandidate.length >= 1 &&
          normalizedText.includes(normalizedCandidate)
        );
      }),
    );
}
