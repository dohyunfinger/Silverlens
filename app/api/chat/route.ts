import { NextResponse } from "next/server";
import { getHealthTerm } from "../../../backend/data/healthTerms";
import {
  generateSeniorFriendlyAnswer,
  type ConversationTurn,
  type HealthNote,
  type ImagePurpose,
  IMAGE_PURPOSES,
  type InlineImage,
  type InlineMedia,
  isMeaningfulText,
  type UserGender,
  type UserProfile,
} from "../../../backend/services/geminiService";
import { isGeminiQuotaError } from "../../../backend/services/geminiQuota";

const MAX_INLINE_DATA_LENGTH = 18 * 1024 * 1024;
/**
 * 한 번에 보낼 수 있는 사진 수.
 * 한 상에 놓인 반찬을 여러 번 찍어 보내는 경우를 감당할 만큼만 열어 둔다.
 * 더 늘리면 요청이 커져 휴대폰에서 업로드가 오래 걸린다.
 */
const MAX_IMAGES = 4;

function isInlineMedia(value: unknown): value is InlineMedia {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<InlineMedia>;
  return (
    typeof candidate.data === "string" &&
    candidate.data.length > 0 &&
    typeof candidate.mimeType === "string" &&
    candidate.mimeType.length > 0
  );
}

function cleanImagePurpose(value: unknown): ImagePurpose | null {
  return IMAGE_PURPOSES.includes(value as ImagePurpose)
    ? (value as ImagePurpose)
    : null;
}

/**
 * 사진 목록을 걸러 낸다.
 *
 * 화면은 `images` 배열로 보내지만, 브라우저에 옛 화면이 캐시로 남아 있으면
 * 예전처럼 `image` 하나만 보낼 수 있다. 두 형태를 모두 받아 준다.
 */
function cleanImages(body: {
  images?: unknown;
  image?: unknown;
  imagePurpose?: unknown;
}): InlineImage[] {
  const raw = Array.isArray(body.images)
    ? body.images
    : body.image
      ? [{ ...(body.image as object), purpose: body.imagePurpose }]
      : [];

  const cleaned: InlineImage[] = [];
  for (const item of raw) {
    if (!isInlineMedia(item)) continue;
    const purpose = cleanImagePurpose((item as { purpose?: unknown }).purpose);
    cleaned.push({
      media: { data: item.data, mimeType: item.mimeType },
      purpose,
    });
    if (cleaned.length >= MAX_IMAGES) break;
  }
  return cleaned;
}

function cleanHistory(value: unknown): ConversationTurn[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> =>
      Boolean(item && typeof item === "object"),
    )
    .map((item) => ({
      question:
        typeof item.question === "string" ? item.question.trim().slice(0, 1000) : "",
      answer:
        typeof item.answer === "string" ? item.answer.trim().slice(0, 2200) : "",
    }))
    .filter((item) => isMeaningfulText(item.question) && isMeaningfulText(item.answer))
    .slice(-6);
}

const NOTE_KINDS: HealthNote["kind"][] = ["allergy", "condition", "setup"];

/** 음성 메모는 사용자 입력이라 길이·개수·종류를 서버에서 다시 잘라 낸다. */
function cleanHealthNotes(value: unknown): HealthNote[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> =>
      Boolean(item && typeof item === "object"),
    )
    .map((item) => ({
      kind: NOTE_KINDS.includes(item.kind as HealthNote["kind"])
        ? (item.kind as HealthNote["kind"])
        : "setup",
      text: typeof item.text === "string" ? item.text.trim().slice(0, 400) : "",
    }))
    .filter((note) => isMeaningfulText(note.text))
    .slice(-8);
}

const GENDERS: UserGender[] = ["male", "female"];

/**
 * 카탈로그에 없는 건강 정보 ID를 걸러 낸다.
 *
 * 안전 하한선은 ID로 규칙을 찾는데, 프롬프트에 들어가는 라벨은 ID를 못 찾으면
 * ID 문자열을 그대로 쓴다. 그래서 오타난 ID(예: 밑줄 대신 하이픈)를 보내면
 * 모델은 질병이 있다고 읽지만 하한선은 발동하지 않아 위험도가 낮게 나온다.
 * 두 경로가 늘 같은 정보를 보게 여기서 잘라 낸다.
 * 사용자가 직접 적은 항목은 `custom:` 접두사를 쓰므로 그대로 통과시킨다.
 */
function cleanHealthIds(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const cleaned = value.filter(
    (id): id is string =>
      typeof id === "string" &&
      (id.startsWith("custom:") || Boolean(getHealthTerm(id))),
  );
  return [...new Set(cleaned)].slice(0, 40);
}

function cleanProfile(value: unknown): UserProfile {
  if (!value || typeof value !== "object") return {};
  const profile = value as UserProfile & {
    healthNotes?: unknown;
    gender?: unknown;
    allergyIds?: unknown;
    conditionIds?: unknown;
  };
  const allergyIds = cleanHealthIds(profile.allergyIds);
  const conditionIds = cleanHealthIds(profile.conditionIds);
  return {
    ...profile,
    // 성별은 프롬프트에 그대로 들어가므로 정해진 두 값만 통과시킨다.
    gender: GENDERS.includes(profile.gender as UserGender)
      ? (profile.gender as UserGender)
      : undefined,
    allergyIds,
    conditionIds,
    // ID를 보냈으면 그것만 믿고 라벨은 서버가 다시 만든다(geminiService가 처리).
    // 화면이 보낸 라벨을 함께 쓰면 걸러 낸 ID의 라벨이 살아남아 다시 어긋난다.
    allergies: allergyIds ? undefined : profile.allergies,
    conditions: conditionIds ? undefined : profile.conditions,
    healthNotes: cleanHealthNotes(profile.healthNotes),
  };
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      message?: unknown;
      audio?: unknown;
      images?: unknown;
      image?: unknown;
      imagePurpose?: unknown;
      profile?: unknown;
      history?: unknown;
    };
    const message = typeof body.message === "string" ? body.message.trim() : "";
    const audio = isInlineMedia(body.audio) ? body.audio : null;
    // 촬영 목적도 프롬프트에 들어가므로 정해진 세 값만 통과시킨다.
    const images = cleanImages(body);
    if (!isMeaningfulText(message) && !audio && images.length === 0) {
      return NextResponse.json(
        { error: "글, 음성, 사진 중 하나 이상을 보내 주세요." },
        { status: 400 },
      );
    }
    if (message.length > 1000) {
      return NextResponse.json(
        { error: "질문은 1,000자 이하로 입력해 주세요." },
        { status: 400 },
      );
    }
    // 사진 여러 장을 합친 크기로 판단한다. 한 장씩 볼 때와 기준이 달라야 한다.
    const attachedBytes =
      (audio?.data.length ?? 0) +
      images.reduce((total, image) => total + image.media.data.length, 0);
    if (attachedBytes > MAX_INLINE_DATA_LENGTH) {
      return NextResponse.json(
        { error: "첨부 파일이 너무 큽니다. 사진 수를 줄이거나 더 짧은 음성을 사용해 주세요." },
        { status: 413 },
      );
    }
    const result = await generateSeniorFriendlyAnswer(
      message,
      cleanProfile(body.profile),
      { audio, images },
      cleanHistory(body.history),
    );
    return NextResponse.json({
      answer: result.answer,
      riskLevel: result.riskLevel,
      warningMessage: result.warningMessage,
    });
  } catch (error) {
    if (isGeminiQuotaError(error)) {
      return NextResponse.json(
        { error: error.message, retryAfterSeconds: error.retryAfterSeconds },
        { status: 429, headers: { "Retry-After": String(error.retryAfterSeconds) } },
      );
    }
    const message =
      error instanceof Error ? error.message : "서버에서 답변을 만들지 못했습니다.";
    const status = message.includes("GEMINI_API_KEY") ? 503 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
