import { mfdsSchemaStatements } from "../../db/schema";
import {
  findPillCandidates,
  normalizedDrugText,
  rankPillCandidates,
  type PillCandidate,
  type PillIdentificationRecord,
  type PillObservation,
} from "../data/loadData";

const MFDS_ENDPOINT =
  "https://apis.data.go.kr/1471000/MdcinGrnIdntfcInfoService03/getMdcinGrnIdntfcInfoList03";
const PAGE_SIZE = 500;
const PAGES_PER_RUN = 2;
const UPSERT_BATCH_SIZE = 80;
const LOCK_TTL_MS = 15 * 60 * 1000;

type D1Result<T = Record<string, unknown>> = {
  results?: T[];
  success?: boolean;
  meta?: { changes?: number };
};

export type D1Statement = {
  bind: (...values: unknown[]) => D1Statement;
  first: <T = Record<string, unknown>>() => Promise<T | null>;
  all: <T = Record<string, unknown>>() => Promise<D1Result<T>>;
  run: () => Promise<D1Result>;
};

export type D1Database = {
  prepare: (query: string) => D1Statement;
  batch: (statements: D1Statement[]) => Promise<D1Result[]>;
};

export type MfdsRuntimeEnv = {
  DB?: D1Database;
  MFDS_DATA_API_KEY?: string;
};

type SyncStateRow = {
  generation: string;
  next_page: number;
  total_pages: number;
  total_count: number;
  records_synced: number;
  last_started_at: number | null;
  last_success_at: number | null;
  last_error: string;
  locked_until: number;
};

type PillRow = {
  item_seq: string;
  item_name: string;
  manufacturer: string;
  description: string;
  image_url: string;
  imprint_front: string;
  imprint_back: string;
  shape: string;
  color_front: string;
  color_back: string;
  score_line_front: string;
  score_line_back: string;
  length_long: string;
  length_short: string;
  thickness: string;
  class_name: string;
  otc_type: string;
  dosage_form: string;
  english_name: string;
  standard_code: string;
};

export type MfdsSyncResult = {
  status: "completed" | "progress" | "skipped";
  recordsSynced: number;
  totalCount: number;
  nextPage: number;
  reason?: "missing_binding" | "missing_key" | "locked";
};

export type MfdsCatalogStatus = {
  configured: boolean;
  apiKeyConfigured: boolean;
  recordCount: number;
  syncing: boolean;
  nextPage: number;
  totalPages: number;
  totalCount: number;
  lastSuccessAt: number | null;
  lastError: string;
};

const initializedDatabases = new WeakSet<object>();
let runtimeDatabase: D1Database | null = null;

async function ensureMfdsSchema(database: D1Database) {
  if (initializedDatabases.has(database as object)) return;
  await database.batch(
    mfdsSchemaStatements.map((statement) => database.prepare(statement)),
  );
  initializedDatabases.add(database as object);
}

async function loadRuntimeDb() {
  if (runtimeDatabase) return runtimeDatabase;
  const runtime = (await import("cloudflare:workers")) as unknown as {
    env: MfdsRuntimeEnv;
  };
  if (!runtime.env.DB) throw new Error("MFDS_DATA_NOT_CONFIGURED");
  runtimeDatabase = runtime.env.DB;
  return runtimeDatabase;
}

function asText(value: unknown) {
  return value === null || value === undefined ? "" : String(value).trim();
}

function decodeApiKey(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function normalizeApiRecord(item: Record<string, unknown>): PillIdentificationRecord {
  return {
    itemSeq: asText(item.ITEM_SEQ),
    itemName: asText(item.ITEM_NAME),
    manufacturer: asText(item.ENTP_NAME),
    description: asText(item.CHART),
    imageUrl: asText(item.ITEM_IMAGE),
    imprintFront: asText(item.PRINT_FRONT || item.MARK_CODE_FRONT_ANAL),
    imprintBack: asText(item.PRINT_BACK || item.MARK_CODE_BACK_ANAL),
    shape: asText(item.DRUG_SHAPE),
    colorFront: asText(item.COLOR_CLASS1),
    colorBack: asText(item.COLOR_CLASS2),
    scoreLineFront: asText(item.LINE_FRONT),
    scoreLineBack: asText(item.LINE_BACK),
    lengthLong: asText(item.LENG_LONG),
    lengthShort: asText(item.LENG_SHORT),
    thickness: asText(item.THICK),
    className: asText(item.CLASS_NAME),
    otcType: asText(item.ETC_OTC_NAME),
    dosageForm: asText(item.FORM_CODE_NAME),
    englishName: asText(item.ITEM_ENG_NAME),
    standardCode: asText(item.STD_CD),
  };
}

function recordsFromPayload(payload: Record<string, unknown>) {
  const body = payload.body as Record<string, unknown> | undefined;
  const itemsContainer = body?.items as Record<string, unknown> | undefined;
  const rawItems = itemsContainer?.item;
  const items = Array.isArray(rawItems) ? rawItems : rawItems ? [rawItems] : [];
  return items
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
    .map(normalizeApiRecord)
    .filter((record) => record.itemSeq && record.itemName);
}

async function fetchMfdsPage(apiKey: string, pageNo: number) {
  const url = new URL(MFDS_ENDPOINT);
  url.searchParams.set("serviceKey", decodeApiKey(apiKey));
  url.searchParams.set("pageNo", String(pageNo));
  url.searchParams.set("numOfRows", String(PAGE_SIZE));
  url.searchParams.set("type", "json");

  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`MFDS_HTTP_${response.status}`);

  const raw = await response.text();
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error("MFDS_INVALID_JSON");
  }

  const responseBody = (parsed.response ?? parsed) as Record<string, unknown>;
  const header = (responseBody.header ?? parsed.header) as Record<string, unknown> | undefined;
  const resultCode = asText(header?.resultCode);
  if (resultCode && resultCode !== "00") {
    throw new Error(`MFDS_API_${resultCode}:${asText(header?.resultMsg).slice(0, 120)}`);
  }

  const body = responseBody.body as Record<string, unknown> | undefined;
  return {
    records: recordsFromPayload(responseBody),
    totalCount: Number(body?.totalCount ?? 0),
  };
}

const UPSERT_SQL = `INSERT INTO mfds_pills (
  item_seq, item_name, manufacturer, description, image_url,
  imprint_front, imprint_back, shape, color_front, color_back,
  score_line_front, score_line_back, length_long, length_short, thickness,
  class_name, otc_type, dosage_form, english_name, standard_code,
  item_name_search, manufacturer_search, imprint_front_search, imprint_back_search,
  sync_generation, updated_at
) VALUES (${Array.from({ length: 26 }, () => "?").join(", ")})
ON CONFLICT(item_seq) DO UPDATE SET
  item_name=excluded.item_name, manufacturer=excluded.manufacturer,
  description=excluded.description, image_url=excluded.image_url,
  imprint_front=excluded.imprint_front, imprint_back=excluded.imprint_back,
  shape=excluded.shape, color_front=excluded.color_front, color_back=excluded.color_back,
  score_line_front=excluded.score_line_front, score_line_back=excluded.score_line_back,
  length_long=excluded.length_long, length_short=excluded.length_short,
  thickness=excluded.thickness, class_name=excluded.class_name,
  otc_type=excluded.otc_type, dosage_form=excluded.dosage_form,
  english_name=excluded.english_name, standard_code=excluded.standard_code,
  item_name_search=excluded.item_name_search,
  manufacturer_search=excluded.manufacturer_search,
  imprint_front_search=excluded.imprint_front_search,
  imprint_back_search=excluded.imprint_back_search,
  sync_generation=excluded.sync_generation, updated_at=excluded.updated_at`;

function upsertStatement(
  database: D1Database,
  record: PillIdentificationRecord,
  generation: string,
  updatedAt: number,
) {
  return database.prepare(UPSERT_SQL).bind(
    record.itemSeq, record.itemName, record.manufacturer, record.description,
    record.imageUrl, record.imprintFront, record.imprintBack, record.shape,
    record.colorFront, record.colorBack, record.scoreLineFront, record.scoreLineBack,
    record.lengthLong, record.lengthShort, record.thickness, record.className,
    record.otcType, record.dosageForm, record.englishName, record.standardCode,
    normalizedDrugText(record.itemName), normalizedDrugText(record.manufacturer),
    normalizedDrugText(record.imprintFront), normalizedDrugText(record.imprintBack),
    generation, updatedAt,
  );
}

async function upsertRecords(
  database: D1Database,
  records: PillIdentificationRecord[],
  generation: string,
) {
  const updatedAt = Date.now();
  for (let index = 0; index < records.length; index += UPSERT_BATCH_SIZE) {
    await database.batch(
      records
        .slice(index, index + UPSERT_BATCH_SIZE)
        .map((record) => upsertStatement(database, record, generation, updatedAt)),
    );
  }
}

/** Cron에서 여러 페이지만 처리하고 진행 위치를 D1에 남겨 실행시간을 제한한다. */
export async function syncMfdsPillCatalog(env: MfdsRuntimeEnv): Promise<MfdsSyncResult> {
  const database = env.DB;
  const apiKey = env.MFDS_DATA_API_KEY?.trim();
  if (!database) {
    return { status: "skipped", reason: "missing_binding", recordsSynced: 0, totalCount: 0, nextPage: 1 };
  }
  if (!apiKey) {
    return { status: "skipped", reason: "missing_key", recordsSynced: 0, totalCount: 0, nextPage: 1 };
  }

  await ensureMfdsSchema(database);
  const now = Date.now();
  const lock = await database.prepare(
    "UPDATE mfds_sync_state SET locked_until = ? WHERE id = 'catalog' AND locked_until <= ?",
  ).bind(now + LOCK_TTL_MS, now).run();
  if ((lock.meta?.changes ?? 0) === 0) {
    return { status: "skipped", reason: "locked", recordsSynced: 0, totalCount: 0, nextPage: 1 };
  }

  try {
    const state = await database.prepare(
      "SELECT * FROM mfds_sync_state WHERE id = 'catalog'",
    ).first<SyncStateRow>();
    if (!state) throw new Error("MFDS_SYNC_STATE_MISSING");

    const generation = state.generation || `${now}-${crypto.randomUUID()}`;
    let pageNo = state.generation ? Math.max(1, state.next_page) : 1;
    let recordsSynced = state.generation ? state.records_synced : 0;
    let totalCount = state.generation ? state.total_count : 0;

    if (!state.generation) {
      await database.prepare(
        `UPDATE mfds_sync_state SET generation = ?, next_page = 1,
         total_pages = 0, total_count = 0, records_synced = 0,
         last_started_at = ?, last_error = '' WHERE id = 'catalog'`,
      ).bind(generation, now).run();
    }

    for (let processed = 0; processed < PAGES_PER_RUN; processed += 1) {
      const page = await fetchMfdsPage(apiKey, pageNo);
      totalCount = page.totalCount;
      if (!Number.isFinite(totalCount) || totalCount <= 0) {
        throw new Error("MFDS_EMPTY_CATALOG");
      }
      const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
      await upsertRecords(database, page.records, generation);
      recordsSynced += page.records.length;

      if (pageNo >= totalPages) {
        await database.prepare(
          "DELETE FROM mfds_pills WHERE sync_generation <> ?",
        ).bind(generation).run();
        await database.prepare(
          `UPDATE mfds_sync_state SET generation = '', next_page = 1,
           total_pages = ?, total_count = ?, records_synced = ?,
           last_success_at = ?, last_error = '' WHERE id = 'catalog'`,
        ).bind(totalPages, totalCount, recordsSynced, Date.now()).run();
        return { status: "completed", recordsSynced, totalCount, nextPage: 1 };
      }

      pageNo += 1;
      await database.prepare(
        `UPDATE mfds_sync_state SET next_page = ?, total_pages = ?,
         total_count = ?, records_synced = ?, last_error = '' WHERE id = 'catalog'`,
      ).bind(pageNo, totalPages, totalCount, recordsSynced).run();
    }

    return { status: "progress", recordsSynced, totalCount, nextPage: pageNo };
  } catch (error) {
    const message = error instanceof Error ? error.message : "MFDS_SYNC_FAILED";
    await database.prepare(
      "UPDATE mfds_sync_state SET last_error = ? WHERE id = 'catalog'",
    ).bind(message.slice(0, 240)).run();
    throw error;
  } finally {
    await database.prepare(
      "UPDATE mfds_sync_state SET locked_until = 0 WHERE id = 'catalog'",
    ).run();
  }
}

function rowToRecord(row: PillRow): PillIdentificationRecord {
  return {
    itemSeq: row.item_seq,
    itemName: row.item_name,
    manufacturer: row.manufacturer,
    description: row.description,
    imageUrl: row.image_url,
    imprintFront: row.imprint_front,
    imprintBack: row.imprint_back,
    shape: row.shape,
    colorFront: row.color_front,
    colorBack: row.color_back,
    scoreLineFront: row.score_line_front,
    scoreLineBack: row.score_line_back,
    lengthLong: row.length_long,
    lengthShort: row.length_short,
    thickness: row.thickness,
    className: row.class_name,
    otcType: row.otc_type,
    dosageForm: row.dosage_form,
    englishName: row.english_name,
    standardCode: row.standard_code,
  };
}

/** 배포에서는 D1을 우선 검색하고, 준비 전에는 기존 로컬 JSON을 사용한다. */
export async function findRuntimePillCandidates(
  observation: PillObservation | null | undefined,
  limit = 5,
): Promise<PillCandidate[]> {
  if (!observation) return [];
  const product = normalizedDrugText(observation.productText);
  const front = normalizedDrugText(observation.imprintFront);
  const back = normalizedDrugText(observation.imprintBack);
  if (product.length < 2 && front.length < 2 && back.length < 2) {
    return [];
  }

  try {
    const database = await loadRuntimeDb();
    await ensureMfdsSchema(database);
    const result = await database.prepare(
      `SELECT item_seq, item_name, manufacturer, description, image_url,
       imprint_front, imprint_back, shape, color_front, color_back,
       score_line_front, score_line_back, length_long, length_short, thickness,
       class_name, otc_type, dosage_form, english_name, standard_code
       FROM mfds_pills
       WHERE (? <> '' AND item_name_search LIKE '%' || ? || '%')
          OR (? <> '' AND (imprint_front_search LIKE '%' || ? || '%'
                       OR imprint_back_search LIKE '%' || ? || '%'))
          OR (? <> '' AND (imprint_back_search LIKE '%' || ? || '%'
                       OR imprint_front_search LIKE '%' || ? || '%'))
       LIMIT 160`,
    ).bind(
      product, product,
      front, front, front,
      back, back, back,
    ).all<PillRow>();
    const records = (result.results ?? []).map(rowToRecord);
    if (records.length > 0) return rankPillCandidates(observation, records, limit);
  } catch (error) {
    console.warn(
      "[SilverLens] D1 낱알 검색을 사용할 수 없어 로컬 후보로 계속합니다.",
      error instanceof Error ? error.message : error,
    );
  }
  return findPillCandidates(observation, limit);
}

export async function getMfdsCatalogStatus(): Promise<MfdsCatalogStatus> {
  const apiKeyConfigured = Boolean(process.env.MFDS_DATA_API_KEY?.trim());
  try {
    const database = await loadRuntimeDb();
    await ensureMfdsSchema(database);
    const [countRow, state] = await Promise.all([
      database.prepare("SELECT COUNT(*) AS count FROM mfds_pills").first<{ count: number }>(),
      database.prepare("SELECT * FROM mfds_sync_state WHERE id = 'catalog'").first<SyncStateRow>(),
    ]);
    return {
      configured: true,
      apiKeyConfigured,
      recordCount: Number(countRow?.count ?? 0),
      syncing: Boolean(state?.generation),
      nextPage: Number(state?.next_page ?? 1),
      totalPages: Number(state?.total_pages ?? 0),
      totalCount: Number(state?.total_count ?? 0),
      lastSuccessAt: state?.last_success_at ?? null,
      lastError: state?.last_error ?? "",
    };
  } catch {
    return {
      configured: false,
      apiKeyConfigured,
      recordCount: 0,
      syncing: false,
      nextPage: 1,
      totalPages: 0,
      totalCount: 0,
      lastSuccessAt: null,
      lastError: "",
    };
  }
}
