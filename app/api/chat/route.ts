import { NextResponse } from "next/server";
import {
  generateSeniorFriendlyAnswer,
  type ConversationTurn,
  type InlineMedia,
  isMeaningfulText,
  type UserProfile,
} from "../../../backend/services/geminiService";

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

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      message?: unknown;
      audio?: unknown;
      image?: unknown;
      profile?: UserProfile;
      history?: unknown;
    };
    const message = typeof body.message === "string" ? body.message.trim() : "";
    const audio = isInlineMedia(body.audio) ? body.audio : null;
    const image = isInlineMedia(body.image) ? body.image : null;
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
      body.profile,
      { audio, image },
      cleanHistory(body.history),
    );
    return NextResponse.json({
      answer: result.answer,
      riskLevel: result.riskLevel,
      warningMessage: result.warningMessage,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "서버에서 답변을 만들지 못했습니다.";
    const status = message.includes("GEMINI_API_KEY") ? 503 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
