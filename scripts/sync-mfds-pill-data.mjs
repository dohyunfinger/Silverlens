import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, "..");
const outputPath = resolve(projectRoot, "data", "mfds_pill_identification.json");
const endpoint =
  "https://apis.data.go.kr/1471000/MdcinGrnIdntfcInfoService03/getMdcinGrnIdntfcInfoList03";

function requiredApiKey() {
  const raw = process.env.MFDS_DATA_API_KEY?.trim();
  if (!raw) {
    throw new Error(
      "MFDS_DATA_API_KEY가 없습니다. 공공데이터포털에서 '의약품 낱알식별 정보' 활용신청 후 발급받은 일반 인증키를 설정해 주세요.",
    );
  }
  // 공공데이터포털은 인코딩 키와 디코딩 키를 함께 보여 준다. URLSearchParams가
  // 한 번 인코딩하므로, 인코딩 키가 들어오면 먼저 원래 값으로 되돌린다.
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function asText(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function normalizeRecord(item) {
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

function itemsFrom(payload) {
  const items = payload?.body?.items?.item;
  if (!items) return [];
  return Array.isArray(items) ? items : [items];
}

async function fetchPage(apiKey, pageNo, numOfRows) {
  const url = new URL(endpoint);
  url.searchParams.set("serviceKey", apiKey);
  url.searchParams.set("pageNo", String(pageNo));
  url.searchParams.set("numOfRows", String(numOfRows));
  url.searchParams.set("type", "json");

  const response = await fetch(url, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`식약처 데이터 요청 실패: HTTP ${response.status}`);
  }

  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(`식약처가 JSON이 아닌 응답을 보냈습니다: ${text.slice(0, 160)}`);
  }

  const resultCode = payload?.header?.resultCode ?? payload?.response?.header?.resultCode;
  const resultMessage = payload?.header?.resultMsg ?? payload?.response?.header?.resultMsg;
  if (resultCode && resultCode !== "00") {
    throw new Error(`식약처 데이터 오류 ${resultCode}: ${resultMessage || "원인 미상"}`);
  }

  return payload?.response ?? payload;
}

async function main() {
  const apiKey = requiredApiKey();
  const pageSize = Math.max(
    1,
    Math.min(1000, Number.parseInt(process.env.MFDS_DATA_PAGE_SIZE || "500", 10) || 500),
  );

  const first = await fetchPage(apiKey, 1, pageSize);
  const totalCount = Number(first?.body?.totalCount ?? 0);
  const pageCount = Math.max(1, Math.ceil(totalCount / pageSize));
  const rows = itemsFrom(first);

  for (let pageNo = 2; pageNo <= pageCount; pageNo += 1) {
    const page = await fetchPage(apiKey, pageNo, pageSize);
    rows.push(...itemsFrom(page));
    process.stdout.write(`\r식약처 낱알 데이터 ${Math.min(rows.length, totalCount)}/${totalCount}`);
  }

  const records = rows
    .map(normalizeRecord)
    .filter((record) => record.itemSeq && record.itemName)
    .sort((left, right) => left.itemSeq.localeCompare(right.itemSeq, "ko-KR"));
  const catalog = {
    metadata: {
      source: "식품의약품안전처 의약품 낱알식별 정보 OpenAPI",
      source_url: "https://www.data.go.kr/data/15057639/openapi.do",
      license: "이용허락범위 제한 없음",
      synced_at: new Date().toISOString(),
      note: "공식 OpenAPI 응답을 SilverLens 검색용 필드로 정규화한 데이터입니다.",
    },
    records,
  };

  await writeFile(outputPath, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
  process.stdout.write(`\n${records.length}개 의약품을 저장했습니다.\n`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
