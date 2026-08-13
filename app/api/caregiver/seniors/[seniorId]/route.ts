import { NextRequest, NextResponse } from "next/server";
import {
  getCaregiverSeniorDetail,
  renameCaregiverSenior,
  unlinkCaregiverSenior,
} from "../../../../../backend/services/careData";
import {
  caregiverFromRequest,
  isSameOriginMutation,
} from "../../../../../backend/services/caregiverRequest";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ seniorId: string }> };

async function authenticated(request: NextRequest) {
  const caregiver = await caregiverFromRequest(request);
  return caregiver?.uid ?? null;
}

export async function GET(request: NextRequest, context: RouteContext) {
  const caregiverUid = await authenticated(request);
  if (!caregiverUid) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  try {
    const { seniorId } = await context.params;
    return NextResponse.json(await getCaregiverSeniorDetail(caregiverUid, seniorId), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const missing = error instanceof Error && error.message === "SENIOR_NOT_FOUND";
    return NextResponse.json({ error: missing ? "연결된 시니어를 찾을 수 없습니다." : "정보를 불러오지 못했습니다." }, { status: missing ? 404 : 500 });
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  if (!isSameOriginMutation(request)) return NextResponse.json({ error: "허용되지 않은 요청입니다." }, { status: 403 });
  const caregiverUid = await authenticated(request);
  if (!caregiverUid) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  try {
    const { seniorId } = await context.params;
    const body = (await request.json()) as { alias?: unknown };
    const senior = await renameCaregiverSenior(
      caregiverUid,
      seniorId,
      typeof body.alias === "string" ? body.alias : "",
    );
    return NextResponse.json({ senior }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    return NextResponse.json({ error: code === "INVALID_ALIAS" ? "표시 이름을 입력해 주세요." : "이름을 바꾸지 못했습니다." }, { status: code === "INVALID_ALIAS" ? 400 : 404 });
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  if (!isSameOriginMutation(request)) return NextResponse.json({ error: "허용되지 않은 요청입니다." }, { status: 403 });
  const caregiverUid = await authenticated(request);
  if (!caregiverUid) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  const { seniorId } = await context.params;
  await unlinkCaregiverSenior(caregiverUid, seniorId);
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
