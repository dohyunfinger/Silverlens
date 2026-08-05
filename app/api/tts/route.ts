import { NextResponse } from "next/server";
import { isMeaningfulText } from "../../../backend/services/geminiService";
import { generateNarration } from "../../../backend/services/ttsService";
import { isGeminiQuotaError } from "../../../backend/services/geminiQuota";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      text?: unknown;
      language?: unknown;
    };
    if (!isMeaningfulText(body.text)) {
      return NextResponse.json({ error: "읽을 문장을 입력해 주세요." }, { status: 400 });
    }
    const text = body.text.trim();
    if (text.length > 800) {
      return NextResponse.json(
        { error: "한 번에 읽을 문장은 800자 이하로 입력해 주세요." },
        { status: 400 },
      );
    }
    const language = typeof body.language === "string" ? body.language : "ko-KR";
    const wav = await generateNarration(text, language);
    return new Response(wav, {
      headers: {
        "Content-Type": "audio/wav",
        /*
         * 같은 문장을 다시 들을 때 서버까지 가지 않도록 브라우저 캐시를 허용한다.
         * 건강 정보가 담긴 음성이라 공용 캐시(CDN)에는 저장하지 않는다.
         */
        "Cache-Control": "private, max-age=1800",
      },
    });
  } catch (error) {
    if (isGeminiQuotaError(error)) {
      return NextResponse.json(
        { error: error.message, retryAfterSeconds: error.retryAfterSeconds },
        { status: 429, headers: { "Retry-After": String(error.retryAfterSeconds) } },
      );
    }
    const message =
      error instanceof Error ? error.message : "음성을 만들지 못했습니다.";
    const status = message.includes("GEMINI_API_KEY") ? 503 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
