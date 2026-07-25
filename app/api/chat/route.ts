import { NextResponse } from "next/server";
import {
  generateSeniorFriendlyAnswer,
  isMeaningfulText,
  type UserProfile,
} from "../../../backend/services/geminiService";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      message?: unknown;
      profile?: UserProfile;
    };
    if (!isMeaningfulText(body.message)) {
      return NextResponse.json(
        { error: "글자나 숫자가 포함된 질문을 입력해 주세요." },
        { status: 400 },
      );
    }
    if (body.message.trim().length > 1000) {
      return NextResponse.json(
        { error: "질문은 1,000자 이하로 입력해 주세요." },
        { status: 400 },
      );
    }
    const answer = await generateSeniorFriendlyAnswer(
      body.message.trim(),
      body.profile,
    );
    return NextResponse.json({ answer });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "서버에서 답변을 만들지 못했습니다.";
    const status = message.includes("GEMINI_API_KEY") ? 503 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
