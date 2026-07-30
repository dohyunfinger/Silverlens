import { NextResponse } from "next/server";
import {
  type InlineMedia,
} from "../../../backend/services/geminiService";
import {
  transcribeAudio,
  type TranscriptionPurpose,
} from "../../../backend/services/transcriptionService";
import { isGeminiQuotaError } from "../../../backend/services/geminiQuota";

const MAX_AUDIO_DATA_LENGTH = 14 * 1024 * 1024;

function isInlineAudio(value: unknown): value is InlineMedia {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<InlineMedia>;
  return (
    typeof candidate.data === "string" &&
    candidate.data.length > 0 &&
    candidate.data.length <= MAX_AUDIO_DATA_LENGTH &&
    typeof candidate.mimeType === "string" &&
    candidate.mimeType.startsWith("audio/")
  );
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      audio?: unknown;
      purpose?: unknown;
      language?: unknown;
    };
    if (!isInlineAudio(body.audio)) {
      return NextResponse.json(
        { error: "지원되는 음성 파일을 보내 주세요." },
        { status: 400 },
      );
    }
    const allowedPurposes: TranscriptionPurpose[] = [
      "chat",
      "setup",
      "allergy",
      "condition",
    ];
    const purpose = allowedPurposes.includes(
      body.purpose as TranscriptionPurpose,
    )
      ? (body.purpose as TranscriptionPurpose)
      : "chat";
    const language = typeof body.language === "string" ? body.language : "ko-KR";
    const result = await transcribeAudio(body.audio, purpose, language);
    return NextResponse.json({
      text: result.transcript,
      allergies: result.allergies,
      conditions: result.conditions,
      gender: result.gender,
      ageBand: result.ageBand,
    });
  } catch (error) {
    if (isGeminiQuotaError(error)) {
      return NextResponse.json(
        { error: error.message, retryAfterSeconds: error.retryAfterSeconds },
        { status: 429, headers: { "Retry-After": String(error.retryAfterSeconds) } },
      );
    }
    const message =
      error instanceof Error ? error.message : "음성을 글자로 바꾸지 못했습니다.";
    const status = message.includes("GEMINI_API_KEY") ? 503 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
