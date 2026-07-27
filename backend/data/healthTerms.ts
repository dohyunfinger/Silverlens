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

export function resolveHealthTermId(kind: HealthKind, value: string) {
  const target = normalize(value);
  if (!target) return null;
  const match = getHealthTerms(kind).find((term) =>
    [
      term.id,
      ...Object.values(term.labels),
      ...term.aliases,
    ].some((candidate) => normalize(candidate) === target),
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
