import { NextRequest, NextResponse } from "next/server";
import { getCaregiverThread } from "../../../../../backend/services/careData";
import { caregiverFromRequest } from "../../../../../backend/services/caregiverRequest";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ threadId: string }> },
) {
  const caregiver = await caregiverFromRequest(request);
  if (!caregiver) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  try {
    const { threadId } = await context.params;
    return NextResponse.json(await getCaregiverThread(caregiver.uid, threadId), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json({ error: "대화 기록을 찾을 수 없습니다." }, { status: 404 });
  }
}
