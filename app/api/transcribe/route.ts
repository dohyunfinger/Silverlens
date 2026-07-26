import { NextResponse } from "next/server";
import {
  type InlineMedia,
} from "../../../backend/services/geminiService";
import { transcribeAudio } from "../../../backend/services/transcriptionService";

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
    const body = (await request.json()) as { audio?: unknown };
    if (!isInlineAudio(body.audio)) {
      return NextResponse.json(
        { error: "지원되는 음성 파일을 보내 주세요." },
        { status: 400 },
      );
    }
    return NextResponse.json({ text: await transcribeAudio(body.audio) });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "음성을 글자로 바꾸지 못했습니다.";
    const status = message.includes("GEMINI_API_KEY") ? 503 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
