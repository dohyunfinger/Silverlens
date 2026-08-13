import { NextRequest, NextResponse } from "next/server";
import {
  deleteCaregiverThread,
  getCaregiverThread,
} from "../../../../../backend/services/careData";
import {
  caregiverFromRequest,
  isSameOriginMutation,
} from "../../../../../backend/services/caregiverRequest";

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

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ threadId: string }> },
) {
  if (!isSameOriginMutation(request)) {
    return NextResponse.json({ error: "허용되지 않은 요청입니다." }, { status: 403 });
  }
  const caregiver = await caregiverFromRequest(request);
  if (!caregiver) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }
  try {
    const { threadId } = await context.params;
    return NextResponse.json(
      await deleteCaregiverThread(caregiver.uid, threadId),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { error: "대화 기록을 찾을 수 없습니다." },
      { status: 404 },
    );
  }
}
