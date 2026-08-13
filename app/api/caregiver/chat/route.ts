import { NextRequest, NextResponse } from "next/server";
import {
  prepareCaregiverChat,
  saveCaregiverChat,
} from "../../../../backend/services/careData";
import {
  caregiverFromRequest,
  isSameOriginMutation,
} from "../../../../backend/services/caregiverRequest";
import { generateSeniorFriendlyAnswer } from "../../../../backend/services/geminiService";
import { isGeminiQuotaError } from "../../../../backend/services/geminiQuota";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!isSameOriginMutation(request)) {
    return NextResponse.json({ error: "허용되지 않은 요청입니다." }, { status: 403 });
  }
  const caregiver = await caregiverFromRequest(request);
  if (!caregiver) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  try {
    const body = (await request.json()) as {
      message?: unknown;
      threadId?: unknown;
      seniorId?: unknown;
    };
    const message = typeof body.message === "string" ? body.message.trim().slice(0, 1600) : "";
    if (!message) return NextResponse.json({ error: "질문을 입력해 주세요." }, { status: 400 });
    const prepared = await prepareCaregiverChat({
      caregiverUid: caregiver.uid,
      threadId: typeof body.threadId === "string" ? body.threadId : undefined,
      seniorId: typeof body.seniorId === "string" ? body.seniorId : null,
      message,
    });
    const result = await generateSeniorFriendlyAnswer(
      message,
      prepared.profile,
      { audio: null, images: [] },
      prepared.history,
      prepared.caregiverContext,
    );
    await saveCaregiverChat({
      caregiverUid: caregiver.uid,
      threadId: prepared.threadId,
      message,
      answer: result.answer,
      riskLevel: result.riskLevel,
      warningMessage: result.warningMessage,
    });
    return NextResponse.json(
      {
        threadId: prepared.threadId,
        answer: result.answer,
        riskLevel: result.riskLevel,
        warningMessage: result.warningMessage,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (isGeminiQuotaError(error)) {
      return NextResponse.json(
        { error: error.message, retryAfterSeconds: error.retryAfterSeconds },
        { status: 429, headers: { "Retry-After": String(error.retryAfterSeconds) } },
      );
    }
    const code = error instanceof Error ? error.message : "";
    const status = code === "SENIOR_NOT_FOUND" || code === "THREAD_NOT_FOUND" ? 404 : code === "CARE_DATA_NOT_CONFIGURED" ? 503 : code.includes("GEMINI_API_KEY") ? 503 : 500;
    return NextResponse.json(
      { error: status === 404 ? "연결 정보나 대화 기록을 찾을 수 없습니다." : status === 503 ? "돌봄 AI 서비스가 아직 준비되지 않았습니다." : "답변을 만들지 못했습니다." },
      { status },
    );
  }
}
