import { careSchemaStatements } from "../../db/schema";
import type {
  CaregiverAnswerContext,
  ConversationTurn,
  HealthNote,
  RiskLevel,
  UserProfile,
} from "./geminiService";

type D1Result<T = Record<string, unknown>> = {
  results?: T[];
  success?: boolean;
  meta?: { changes?: number };
};

type D1Statement = {
  bind: (...values: unknown[]) => D1Statement;
  first: <T = Record<string, unknown>>() => Promise<T | null>;
  all: <T = Record<string, unknown>>() => Promise<D1Result<T>>;
  run: () => Promise<D1Result>;
};

type D1Database = {
  prepare: (query: string) => D1Statement;
  batch: (statements: D1Statement[]) => Promise<D1Result[]>;
};

type RuntimeEnv = { DB?: D1Database };

export type StoredHealthNote = HealthNote & {
  id?: string;
  savedAt?: number;
};

export type SeniorProfileSnapshot = {
  language: "ko-KR" | "en-US" | "ja-JP" | null;
  gender: "male" | "female" | null;
  ageBand: number;
  ageConfirmed: boolean;
  allergyIds: string[];
  conditionIds: string[];
  healthNotes: StoredHealthNote[];
};

export type SeniorChatSnapshot = {
  id: string;
  question: string;
  answer: string;
  pages: string[];
  attachmentLabels: string[];
  riskLevel: RiskLevel;
  warningMessage: string;
};

export type SeniorSnapshot = {
  version: number;
  savedAt: number;
  profile: SeniorProfileSnapshot;
  chatTurns: SeniorChatSnapshot[];
};

export type CaregiverSenior = {
  id: string;
  alias: string;
  linkedAt: number;
  updatedAt: number;
  profile: SeniorProfileSnapshot;
  recentChatCount: number;
};

export type CaregiverThreadSummary = {
  id: string;
  title: string;
  seniorId: string | null;
  seniorAlias: string | null;
  updatedAt: number;
};

export type CaregiverMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  riskLevel: RiskLevel;
  warningMessage: string;
  createdAt: number;
};

const DEFAULT_PROFILE: SeniorProfileSnapshot = {
  language: null,
  gender: null,
  ageBand: 70,
  ageConfirmed: false,
  allergyIds: [],
  conditionIds: [],
  healthNotes: [],
};

/**
 * 어르신이 전화로 읽어도 알아듣기 쉬운 두 글자 낱말만 사용한다.
 * 세 낱말과 숫자 세 자리의 조합은 약 2억 6천만 가지이며, 코드는 로그인한
 * 돌봄이만 10분 동안 한 번 사용할 수 있다.
 */
const KOREAN_CODE_WORDS = [
  "하늘", "바다", "구름", "나무", "장미", "햇살", "달빛", "별빛",
  "노을", "아침", "저녁", "봄날", "여름", "가을", "겨울", "새싹",
  "열매", "보리", "들꽃", "산길", "물결", "샘물", "시내", "호수",
  "강물", "돌담", "마을", "공원", "산책", "소풍", "기차", "버스",
  "우산", "모자", "신발", "가방", "연필", "공책", "책상", "의자",
  "시계", "거울", "창문", "수저", "접시", "찻잔", "만두", "두부",
  "사과", "포도", "딸기", "참외", "수박", "자두", "감자", "호박",
  "멜론", "오이", "당근", "양파", "상추", "가지", "콩밥", "국수",
] as const;

/** 영어 화면에서는 철자와 발음이 단순하고 서로 헷갈리기 어려운 낱말을 사용한다. */
const ENGLISH_CODE_WORDS = [
  "apple", "berry", "bread", "chair", "cloud", "daisy", "field", "flower",
  "forest", "garden", "grape", "green", "happy", "honey", "house", "lemon",
  "light", "melon", "milk", "moon", "morning", "orange", "paper", "peach",
  "pencil", "plant", "plate", "rain", "river", "road", "rose", "school",
  "shoe", "silver", "sky", "smile", "snow", "spoon", "spring", "star",
  "stone", "summer", "sun", "table", "tea", "train", "tree", "water",
  "window", "winter", "yellow", "book", "bowl", "bridge", "carrot", "cherry",
  "clock", "coffee", "lake", "market", "music", "pearl", "sunset", "village",
] as const;

/** 일본어 화면에서는 읽는 법이 여러 개인 한자 대신 쉬운 히라가나 낱말을 사용한다. */
const JAPANESE_CODE_WORDS = [
  "そら", "うみ", "くも", "つき", "ほし", "はな", "かぜ", "もり",
  "やま", "かわ", "いけ", "にじ", "あさ", "よる", "はる", "なつ",
  "あき", "ふゆ", "みち", "えき", "いえ", "まど", "いす", "つくえ",
  "ほん", "かさ", "くつ", "かばん", "とけい", "でんわ", "でんしゃ", "ばす",
  "りんご", "ぶどう", "いちご", "みかん", "すいか", "めろん", "もも", "なし",
  "くり", "いも", "まめ", "こめ", "ぱん", "もち", "そば", "うどん",
  "みそ", "とうふ", "たまご", "さかな", "やさい", "だいこん", "にんじん", "たまねぎ",
  "きゅうり", "かぼちゃ", "とまと", "れもん", "おちゃ", "みず", "さら", "はし",
] as const;

export type LinkCodeLanguage = NonNullable<SeniorProfileSnapshot["language"]>;

const LINK_CODE_WORDS: Record<LinkCodeLanguage, readonly string[]> = {
  "ko-KR": KOREAN_CODE_WORDS,
  "en-US": ENGLISH_CODE_WORDS,
  "ja-JP": JAPANESE_CODE_WORDS,
};
const LINK_CODE_TTL_MS = 10 * 60 * 1000;
let schemaReady: Promise<void> | null = null;
let databaseBinding: D1Database | null = null;

async function loadDb() {
  if (databaseBinding) return databaseBinding;
  const runtime = (await import("cloudflare:workers")) as unknown as {
    env: RuntimeEnv;
  };
  const binding = runtime.env.DB;
  if (!binding) throw new Error("CARE_DATA_NOT_CONFIGURED");
  databaseBinding = binding;
  return databaseBinding;
}

function db() {
  if (!databaseBinding) throw new Error("CARE_DATA_NOT_CONFIGURED");
  return databaseBinding;
}

export async function ensureCareSchema() {
  if (!schemaReady) {
    schemaReady = loadDb()
      .then((binding) =>
        binding.batch(
          careSchemaStatements.map((statement) => binding.prepare(statement)),
        ),
      )
      .then(() => undefined)
      .catch((error) => {
        schemaReady = null;
        throw error;
      });
  }
  return schemaReady;
}

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function stringList(value: unknown, maxItems = 40, maxLength = 100) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => text(item, maxLength)).filter(Boolean))].slice(
    0,
    maxItems,
  );
}

function risk(value: unknown): RiskLevel {
  return value === "danger" || value === "caution" ? value : "safe";
}

export function sanitizeSeniorSnapshot(value: unknown): SeniorSnapshot {
  const input = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const rawProfile =
    input.profile && typeof input.profile === "object"
      ? (input.profile as Record<string, unknown>)
      : {};
  const language = ["ko-KR", "en-US", "ja-JP"].includes(
    String(rawProfile.language),
  )
    ? (rawProfile.language as SeniorProfileSnapshot["language"])
    : null;
  const gender = rawProfile.gender === "male" || rawProfile.gender === "female"
    ? rawProfile.gender
    : null;
  const ageBand = Number(rawProfile.ageBand);
  const rawNotes = Array.isArray(rawProfile.healthNotes) ? rawProfile.healthNotes : [];
  const healthNotes = rawNotes
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
    .map((item): StoredHealthNote => ({
      id: text(item.id, 80) || undefined,
      kind:
        item.kind === "allergy" || item.kind === "condition" ? item.kind : "setup",
      text: text(item.text, 500),
      savedAt: Number.isFinite(Number(item.savedAt)) ? Number(item.savedAt) : undefined,
    }))
    .filter((item) => item.text)
    .slice(-12);
  const rawTurns = Array.isArray(input.chatTurns) ? input.chatTurns : [];
  const chatTurns = rawTurns
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
    .map((item) => ({
      id: text(item.id, 100) || crypto.randomUUID(),
      question: text(item.question, 1000),
      answer: text(item.answer, 8000),
      pages: stringList(item.pages, 12, 4000),
      attachmentLabels: stringList(item.attachmentLabels, 8, 120),
      riskLevel: risk(item.riskLevel),
      warningMessage: text(item.warningMessage, 1000),
    }))
    .filter((item) => item.question || item.answer)
    .slice(-30);

  return {
    version: 1,
    savedAt: Number.isFinite(Number(input.savedAt)) ? Number(input.savedAt) : Date.now(),
    profile: {
      language,
      gender,
      ageBand: Number.isFinite(ageBand) && ageBand >= 40 && ageBand <= 100 ? ageBand : 70,
      ageConfirmed: rawProfile.ageConfirmed === true,
      allergyIds: stringList(rawProfile.allergyIds),
      conditionIds: stringList(rawProfile.conditionIds),
      healthNotes,
    },
    chatTurns,
  };
}

function safeJson<T>(value: unknown, fallback: T): T {
  try {
    return typeof value === "string" ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function randomToken(bytes = 32) {
  const values = crypto.getRandomValues(new Uint8Array(bytes));
  return [...values].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function linkCodeLanguage(
  value: unknown,
  fallback: SeniorProfileSnapshot["language"],
): LinkCodeLanguage {
  if (value === "ko-KR" || value === "en-US" || value === "ja-JP") return value;
  return fallback ?? "ko-KR";
}

function randomCode(language: LinkCodeLanguage) {
  const dictionary = LINK_CODE_WORDS[language];
  const values = crypto.getRandomValues(new Uint32Array(4));
  const words = Array.from(values.slice(0, 3))
    .map((value) => dictionary[value % dictionary.length]);
  const digits = String(values[3] % 1000).padStart(3, "0");
  return `${words.join("-")}-${digits}`;
}

function normalizedCode(value: string) {
  return value
    .normalize("NFC")
    .toUpperCase()
    .replace(/[^A-Z0-9가-힣ぁ-ゖァ-ヺー]/g, "")
    .slice(0, 40);
}

function isValidLinkCode(value: string) {
  // 배포 직전에 발급된 기존 영문 코드도 남은 10분 동안 사용할 수 있게 한다.
  return (
    /^[A-Z0-9]{10}$/.test(value) ||
    /^[가-힣]{6}[0-9]{3}$/.test(value) ||
    /^[A-Z]{9,24}[0-9]{3}$/.test(value) ||
    /^[ぁ-ゖァ-ヺー]{6,18}[0-9]{3}$/.test(value)
  );
}

async function authenticateDevice(deviceId: string, deviceSecret: string) {
  if (!deviceId || !deviceSecret) return false;
  const row = await db()
    .prepare("SELECT secret_hash FROM senior_devices WHERE id = ?")
    .bind(deviceId)
    .first<{ secret_hash: string }>();
  return Boolean(row && row.secret_hash === (await sha256(deviceSecret)));
}

export async function issueLinkCode(input: {
  deviceId?: string;
  deviceSecret?: string;
  displayName?: string;
  language?: LinkCodeLanguage;
  snapshot: unknown;
}) {
  await ensureCareSchema();
  const now = Date.now();
  const snapshot = sanitizeSeniorSnapshot(input.snapshot);
  const language = linkCodeLanguage(input.language, snapshot.profile.language);
  const displayName = text(input.displayName, 30) || "어르신";
  let deviceId = text(input.deviceId, 80);
  let deviceSecret = text(input.deviceSecret, 160);

  if (deviceId || deviceSecret) {
    if (!(await authenticateDevice(deviceId, deviceSecret))) {
      throw new Error("INVALID_DEVICE_CREDENTIALS");
    }
    await db()
      .prepare(
        "UPDATE senior_devices SET display_name = ?, profile_json = ?, chat_json = ?, updated_at = ? WHERE id = ?",
      )
      .bind(
        displayName,
        JSON.stringify(snapshot.profile),
        JSON.stringify(snapshot.chatTurns),
        now,
        deviceId,
      )
      .run();
  } else {
    deviceId = crypto.randomUUID();
    deviceSecret = randomToken();
    await db()
      .prepare(
        "INSERT INTO senior_devices (id, secret_hash, display_name, profile_json, chat_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(
        deviceId,
        await sha256(deviceSecret),
        displayName,
        JSON.stringify(snapshot.profile),
        JSON.stringify(snapshot.chatTurns),
        now,
        now,
      )
      .run();
  }

  await db()
    .prepare("DELETE FROM link_codes WHERE senior_id = ? AND used_at IS NULL")
    .bind(deviceId)
    .run();

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const code = randomCode(language);
    const codeHash = await sha256(normalizedCode(code));
    try {
      await db()
        .prepare(
          "INSERT INTO link_codes (code_hash, senior_id, created_at, expires_at, used_at) VALUES (?, ?, ?, ?, NULL)",
        )
        .bind(codeHash, deviceId, now, now + LINK_CODE_TTL_MS)
        .run();
      return {
        deviceId,
        deviceSecret,
        code,
        expiresAt: now + LINK_CODE_TTL_MS,
      };
    } catch {
      // 극히 드문 코드 충돌이면 새 코드를 만든다.
    }
  }
  throw new Error("LINK_CODE_CREATE_FAILED");
}

export async function syncSeniorDevice(input: {
  deviceId: string;
  deviceSecret: string;
  displayName?: string;
  snapshot: unknown;
}) {
  await ensureCareSchema();
  if (!(await authenticateDevice(input.deviceId, input.deviceSecret))) {
    throw new Error("INVALID_DEVICE_CREDENTIALS");
  }
  const snapshot = sanitizeSeniorSnapshot(input.snapshot);
  const now = Date.now();
  await db()
    .prepare(
      "UPDATE senior_devices SET display_name = COALESCE(NULLIF(?, ''), display_name), profile_json = ?, chat_json = ?, updated_at = ? WHERE id = ?",
    )
    .bind(
      text(input.displayName, 30),
      JSON.stringify(snapshot.profile),
      JSON.stringify(snapshot.chatTurns),
      now,
      input.deviceId,
    )
    .run();
  const count = await db()
    .prepare("SELECT COUNT(*) AS count FROM caregiver_seniors WHERE senior_id = ?")
    .bind(input.deviceId)
    .first<{ count: number }>();
  return { syncedAt: now, linkedCaregiverCount: Number(count?.count ?? 0) };
}

export async function claimLinkCode(caregiverUid: string, codeInput: string, aliasInput?: string) {
  await ensureCareSchema();
  const code = normalizedCode(codeInput);
  if (!isValidLinkCode(code)) throw new Error("INVALID_LINK_CODE");
  const now = Date.now();
  const codeHash = await sha256(code);
  const found = await db()
    .prepare(
      `SELECT l.senior_id, d.display_name
       FROM link_codes l JOIN senior_devices d ON d.id = l.senior_id
       WHERE l.code_hash = ? AND l.used_at IS NULL AND l.expires_at > ?`,
    )
    .bind(codeHash, now)
    .first<{ senior_id: string; display_name: string }>();
  if (!found) throw new Error("INVALID_LINK_CODE");
  const claimed = await db()
    .prepare(
      "UPDATE link_codes SET used_at = ? WHERE code_hash = ? AND used_at IS NULL AND expires_at > ?",
    )
    .bind(now, codeHash, now)
    .run();
  if (Number(claimed.meta?.changes ?? 0) !== 1) throw new Error("INVALID_LINK_CODE");
  const alias = text(aliasInput, 30) || text(found.display_name, 30) || "어르신";
  await db()
    .prepare(
      `INSERT INTO caregiver_seniors (caregiver_uid, senior_id, alias, linked_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(caregiver_uid, senior_id) DO UPDATE SET alias = excluded.alias`,
    )
    .bind(caregiverUid, found.senior_id, alias, now)
    .run();
  return getCaregiverSenior(caregiverUid, found.senior_id);
}

type SeniorRow = {
  id: string;
  alias: string;
  linked_at: number;
  updated_at: number;
  profile_json: string;
  chat_json: string;
};

function seniorFromRow(row: SeniorRow): CaregiverSenior {
  const profile = safeJson<SeniorProfileSnapshot>(row.profile_json, DEFAULT_PROFILE);
  const chats = safeJson<SeniorChatSnapshot[]>(row.chat_json, []);
  return {
    id: row.id,
    alias: row.alias,
    linkedAt: Number(row.linked_at),
    updatedAt: Number(row.updated_at),
    profile,
    recentChatCount: Array.isArray(chats) ? chats.length : 0,
  };
}

export async function getCaregiverSenior(caregiverUid: string, seniorId: string) {
  await ensureCareSchema();
  const row = await db()
    .prepare(
      `SELECT d.id, c.alias, c.linked_at, d.updated_at, d.profile_json, d.chat_json
       FROM caregiver_seniors c JOIN senior_devices d ON d.id = c.senior_id
       WHERE c.caregiver_uid = ? AND c.senior_id = ?`,
    )
    .bind(caregiverUid, seniorId)
    .first<SeniorRow>();
  if (!row) throw new Error("SENIOR_NOT_FOUND");
  return seniorFromRow(row);
}

export async function getCaregiverSeniorDetail(caregiverUid: string, seniorId: string) {
  await ensureCareSchema();
  const row = await db()
    .prepare(
      `SELECT d.id, c.alias, c.linked_at, d.updated_at, d.profile_json, d.chat_json
       FROM caregiver_seniors c JOIN senior_devices d ON d.id = c.senior_id
       WHERE c.caregiver_uid = ? AND c.senior_id = ?`,
    )
    .bind(caregiverUid, seniorId)
    .first<SeniorRow>();
  if (!row) throw new Error("SENIOR_NOT_FOUND");
  return {
    ...seniorFromRow(row),
    chatTurns: safeJson<SeniorChatSnapshot[]>(row.chat_json, []).slice(-30).reverse(),
  };
}

export async function listCaregiverOverview(caregiverUid: string) {
  await ensureCareSchema();
  const seniorRows = await db()
    .prepare(
      `SELECT d.id, c.alias, c.linked_at, d.updated_at, d.profile_json, d.chat_json
       FROM caregiver_seniors c JOIN senior_devices d ON d.id = c.senior_id
       WHERE c.caregiver_uid = ? ORDER BY c.linked_at DESC`,
    )
    .bind(caregiverUid)
    .all<SeniorRow>();
  const threadRows = await db()
    .prepare(
      `SELECT t.id, t.title, t.senior_id, t.updated_at, c.alias AS senior_alias
       FROM caregiver_threads t
       LEFT JOIN caregiver_seniors c
         ON c.caregiver_uid = t.caregiver_uid AND c.senior_id = t.senior_id
       WHERE t.caregiver_uid = ? ORDER BY t.updated_at DESC LIMIT 80`,
    )
    .bind(caregiverUid)
    .all<{
      id: string;
      title: string;
      senior_id: string | null;
      senior_alias: string | null;
      updated_at: number;
    }>();
  return {
    seniors: (seniorRows.results ?? []).map(seniorFromRow),
    threads: (threadRows.results ?? []).map((row) => ({
      id: row.id,
      title: row.title,
      seniorId: row.senior_id,
      seniorAlias: row.senior_alias,
      updatedAt: Number(row.updated_at),
    } satisfies CaregiverThreadSummary)),
  };
}

export async function renameCaregiverSenior(
  caregiverUid: string,
  seniorId: string,
  aliasInput: string,
) {
  await ensureCareSchema();
  const alias = text(aliasInput, 30);
  if (!alias) throw new Error("INVALID_ALIAS");
  const result = await db()
    .prepare(
      "UPDATE caregiver_seniors SET alias = ? WHERE caregiver_uid = ? AND senior_id = ?",
    )
    .bind(alias, caregiverUid, seniorId)
    .run();
  if (Number(result.meta?.changes ?? 0) !== 1) throw new Error("SENIOR_NOT_FOUND");
  return getCaregiverSenior(caregiverUid, seniorId);
}

export async function unlinkCaregiverSenior(caregiverUid: string, seniorId: string) {
  await ensureCareSchema();
  await db()
    .prepare("DELETE FROM caregiver_seniors WHERE caregiver_uid = ? AND senior_id = ?")
    .bind(caregiverUid, seniorId)
    .run();
}

export async function getCaregiverThread(caregiverUid: string, threadId: string) {
  await ensureCareSchema();
  const thread = await db()
    .prepare(
      "SELECT id, title, senior_id, updated_at FROM caregiver_threads WHERE id = ? AND caregiver_uid = ?",
    )
    .bind(threadId, caregiverUid)
    .first<{ id: string; title: string; senior_id: string | null; updated_at: number }>();
  if (!thread) throw new Error("THREAD_NOT_FOUND");
  const messages = await db()
    .prepare(
      "SELECT id, role, content, risk_level, warning_message, created_at FROM caregiver_messages WHERE thread_id = ? ORDER BY created_at ASC LIMIT 120",
    )
    .bind(threadId)
    .all<{
      id: string;
      role: "user" | "assistant";
      content: string;
      risk_level: string;
      warning_message: string;
      created_at: number;
    }>();
  return {
    thread: {
      id: thread.id,
      title: thread.title,
      seniorId: thread.senior_id,
      updatedAt: Number(thread.updated_at),
    },
    messages: (messages.results ?? []).map((row) => ({
      id: row.id,
      role: row.role,
      content: row.content,
      riskLevel: risk(row.risk_level),
      warningMessage: row.warning_message,
      createdAt: Number(row.created_at),
    } satisfies CaregiverMessage)),
  };
}

export async function deleteCaregiverThread(caregiverUid: string, threadId: string) {
  await ensureCareSchema();
  const owner = await db()
    .prepare("SELECT id FROM caregiver_threads WHERE id = ? AND caregiver_uid = ?")
    .bind(threadId, caregiverUid)
    .first();
  if (!owner) throw new Error("THREAD_NOT_FOUND");

  await db().batch([
    db()
      .prepare("DELETE FROM caregiver_messages WHERE thread_id = ?")
      .bind(threadId),
    db()
      .prepare("DELETE FROM caregiver_threads WHERE id = ? AND caregiver_uid = ?")
      .bind(threadId, caregiverUid),
  ]);
  return { ok: true as const };
}

export async function prepareCaregiverChat(input: {
  caregiverUid: string;
  threadId?: string;
  seniorId?: string | null;
  message: string;
}) {
  await ensureCareSchema();
  let threadId = text(input.threadId, 80);
  let seniorId = text(input.seniorId, 80) || null;
  let profile: UserProfile = { audience: "caregiver", language: "ko-KR" };
  let caregiverContext: CaregiverAnswerContext = {};

  if (threadId) {
    const existing = await db()
      .prepare(
        "SELECT senior_id FROM caregiver_threads WHERE id = ? AND caregiver_uid = ?",
      )
      .bind(threadId, input.caregiverUid)
      .first<{ senior_id: string | null }>();
    if (!existing) throw new Error("THREAD_NOT_FOUND");
    seniorId = existing.senior_id;
  }

  if (seniorId) {
    const senior = await getCaregiverSeniorDetail(input.caregiverUid, seniorId);
    profile = {
      audience: "caregiver",
      language: "ko-KR",
      gender: senior.profile.gender ?? undefined,
      ageBand: senior.profile.ageConfirmed ? senior.profile.ageBand : undefined,
      allergyIds: senior.profile.allergyIds,
      conditionIds: senior.profile.conditionIds,
      healthNotes: senior.profile.healthNotes.map(({ kind, text: noteText }) => ({
        kind,
        text: noteText,
      })),
    };
    caregiverContext = {
      seniorAlias: senior.alias,
      // 상세 조회는 최신순이므로 AI에는 시간 순서대로 전달한다.
      seniorHistory: [...senior.chatTurns]
        .reverse()
        .slice(-12)
        .map((turn) => ({ question: turn.question, answer: turn.answer })),
    };
  }

  if (!threadId) {
    threadId = crypto.randomUUID();
    const now = Date.now();
    await db()
      .prepare(
        "INSERT INTO caregiver_threads (id, caregiver_uid, senior_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .bind(threadId, input.caregiverUid, seniorId, text(input.message, 44), now, now)
      .run();
  }

  const historyRows = await db()
    .prepare(
      "SELECT role, content FROM caregiver_messages WHERE thread_id = ? ORDER BY created_at DESC LIMIT 12",
    )
    .bind(threadId)
    .all<{ role: "user" | "assistant"; content: string }>();
  const ordered = [...(historyRows.results ?? [])].reverse();
  const history: ConversationTurn[] = [];
  for (let index = 0; index < ordered.length - 1; index += 1) {
    if (ordered[index].role === "user" && ordered[index + 1].role === "assistant") {
      history.push({ question: ordered[index].content, answer: ordered[index + 1].content });
      index += 1;
    }
  }
  return {
    threadId,
    seniorId,
    profile,
    history: history.slice(-6),
    caregiverContext,
  };
}

export async function saveCaregiverChat(input: {
  caregiverUid: string;
  threadId: string;
  message: string;
  answer: string;
  riskLevel: RiskLevel;
  warningMessage: string;
}) {
  await ensureCareSchema();
  const now = Date.now();
  const owner = await db()
    .prepare("SELECT id FROM caregiver_threads WHERE id = ? AND caregiver_uid = ?")
    .bind(input.threadId, input.caregiverUid)
    .first();
  if (!owner) throw new Error("THREAD_NOT_FOUND");
  await db().batch([
    db()
      .prepare(
        "INSERT INTO caregiver_messages (id, thread_id, role, content, risk_level, warning_message, created_at) VALUES (?, ?, 'user', ?, 'safe', '', ?)",
      )
      .bind(crypto.randomUUID(), input.threadId, input.message, now),
    db()
      .prepare(
        "INSERT INTO caregiver_messages (id, thread_id, role, content, risk_level, warning_message, created_at) VALUES (?, ?, 'assistant', ?, ?, ?, ?)",
      )
      .bind(
        crypto.randomUUID(),
        input.threadId,
        input.answer,
        input.riskLevel,
        input.warningMessage,
        now + 1,
      ),
    db()
      .prepare("UPDATE caregiver_threads SET updated_at = ? WHERE id = ? AND caregiver_uid = ?")
      .bind(now + 1, input.threadId, input.caregiverUid),
  ]);
  return { savedAt: now + 1 };
}
