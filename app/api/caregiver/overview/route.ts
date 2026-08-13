import { NextRequest, NextResponse } from "next/server";
import { listCaregiverOverview } from "../../../../backend/services/careData";
import { caregiverFromRequest } from "../../../../backend/services/caregiverRequest";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const caregiver = await caregiverFromRequest(request);
  if (!caregiver) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  try {
    return NextResponse.json(await listCaregiverOverview(caregiver.uid), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const unavailable = error instanceof Error && error.message === "CARE_DATA_NOT_CONFIGURED";
    return NextResponse.json(
      { error: unavailable ? "돌봄 데이터 저장소가 아직 연결되지 않았습니다." : "돌봄 정보를 불러오지 못했습니다." },
      { status: unavailable ? 503 : 500 },
    );
  }
}
