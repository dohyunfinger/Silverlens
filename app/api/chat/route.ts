import { NextResponse } from "next/server";
import { getHealthTerm } from "../../../backend/data/healthTerms";
import {
  generateSeniorFriendlyAnswer,
  type ConversationTurn,
  type HealthNote,
  type ImagePurpose,
  IMAGE_PURPOSES,
  type InlineMedia,
  isMeaningfulText,
  type UserGender,
  type UserProfile,
} from "../../../backend/services/geminiService";
import { isGeminiQuotaError } from "../../../backend/services/geminiQuota";

const MAX_INLINE_DATA_LENGTH = 18 * 1024 * 1024;

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
      image?: unknown;
      imagePurpose?: unknown;
      profile?: unknown;
      history?: unknown;
    };
    const message = typeof body.message === "string" ? body.message.trim() : "";
    const audio = isInlineMedia(body.audio) ? body.audio : null;
    const image = isInlineMedia(body.image) ? body.image : null;
    // 촬영 목적도 프롬프트에 들어가므로 정해진 세 값만 통과시킨다.
    const imagePurpose = IMAGE_PURPOSES.includes(body.imagePurpose as ImagePurpose)
      ? (body.imagePurpose as ImagePurpose)
      : null;
    if (!isMeaningfulText(message) && !audio && !image) {
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
    if ((audio?.data.length ?? 0) + (image?.data.length ?? 0) > MAX_INLINE_DATA_LENGTH) {
      return NextResponse.json(
        { error: "첨부 파일이 너무 큽니다. 더 짧은 음성이나 작은 사진을 사용해 주세요." },
        { status: 413 },
      );
    }
    const result = await generateSeniorFriendlyAnswer(
      message,
      cleanProfile(body.profile),
      { audio, image, imagePurpose },
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
