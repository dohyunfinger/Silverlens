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

/**
 * "무", "게", "가지"처럼 짧은 한글 이름은 문장 속 다른 말("무엇", "어떻게", "몇 가지")에
 * 그대로 들어 있어 글자 포함만으로 찾으면 엉뚱한 알레르기 경고가 뜬다.
 * 이런 이름은 낱말 단위로만 본다. 낱말 그대로이거나, 뒤에 조사가 붙거나,
 * "가지볶음"·"무생채"처럼 음식 이름 꼬리가 붙은 경우만 같은 식품으로 인정한다.
 */
const SHORT_HANGUL_NAME = /^\p{Script=Hangul}{1,2}$/u;
const PARTICLE_SUFFIXES = [
  "은", "는", "이", "가", "을", "를", "도", "만", "랑", "이랑", "하고", "과", "와",
  "에", "에는", "로", "으로", "요", "이요", "이나", "나", "같은", "넣은", "든",
];
const DISH_SUFFIXES = [
  "볶음", "무침", "나물", "국", "국밥", "탕", "찜", "전", "구이", "즙", "차", "김치",
  "조림", "생채", "백숙", "주스", "잼", "청", "떡", "밥", "죽", "말랭이", "튀김",
  "샐러드", "소스", "가루", "장아찌", "절임", "깍두기", "고기", "장", "젓", "젓갈", "회",
];
/** "몇 가지", "여러 가지"처럼 개수를 세는 말 뒤의 "가지"는 채소가 아니다. */
const COUNTED_NAMES = new Set(["가지"]);
const COUNTER_WORDS = new Set([
  "몇", "여러", "한", "두", "세", "네", "다섯", "여섯", "일곱", "여덟", "아홉", "열",
  "모든", "온갖", "각", "갖은",
]);

function endsWithOptionalParticle(rest: string, base: string) {
  return rest === base || PARTICLE_SUFFIXES.some((particle) => rest === base + particle);
}

function containsShortName(text: string, name: string) {
  const tokens = text
    .split(/[\s'’"“”.,/#!?$%^&*;:{}=_`~()[\]<>\-+·…]+/u)
    .map(normalize)
    .filter(Boolean);
  return tokens.some((token, index) => {
    if (!token.includes(name)) return false;
    if (COUNTED_NAMES.has(name)) {
      const before = token.startsWith(name) ? tokens[index - 1] : token.slice(0, token.indexOf(name));
      if (before && (COUNTER_WORDS.has(before) || /^\d+$/.test(before))) return false;
    }
    // 낱말 첫머리: "무", "무는", "무생채", "가지볶음을"
    if (token.startsWith(name)) {
      const rest = token.slice(name.length);
      if (endsWithOptionalParticle(rest, "")) return true;
      if (DISH_SUFFIXES.some((suffix) => endsWithOptionalParticle(rest, suffix))) return true;
    }
    // 낱말 끝의 음식 이름: "간장게장", "열무김치"는 맞고 "어떻게"는 음식 꼬리가 없어 제외된다.
    let at = token.indexOf(name, 1);
    while (at > 0) {
      const rest = token.slice(at + name.length);
      if (DISH_SUFFIXES.some((suffix) => endsWithOptionalParticle(rest, suffix))) return true;
      at = token.indexOf(name, at + 1);
    }
    return false;
  });
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
        if (normalizedCandidate.length < 1) return false;
        if (SHORT_HANGUL_NAME.test(normalizedCandidate)) {
          return containsShortName(text, normalizedCandidate);
        }
        return normalizedText.includes(normalizedCandidate);
      }),
    );
}
