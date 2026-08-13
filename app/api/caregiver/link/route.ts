import { NextRequest, NextResponse } from "next/server";
import { claimLinkCode } from "../../../../backend/services/careData";
import {
  caregiverFromRequest,
  isSameOriginMutation,
} from "../../../../backend/services/caregiverRequest";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!isSameOriginMutation(request)) {
    return NextResponse.json({ error: "허용되지 않은 요청입니다." }, { status: 403 });
  }
  const caregiver = await caregiverFromRequest(request);
  if (!caregiver) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  try {
    const body = (await request.json()) as { code?: unknown; alias?: unknown };
    if (typeof body.code !== "string") {
      return NextResponse.json({ error: "연결 코드를 입력해 주세요." }, { status: 400 });
    }
    const senior = await claimLinkCode(
      caregiver.uid,
      body.code,
      typeof body.alias === "string" ? body.alias : undefined,
    );
    return NextResponse.json({ senior }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    const status = code === "INVALID_LINK_CODE" ? 400 : code === "CARE_DATA_NOT_CONFIGURED" ? 503 : 500;
    return NextResponse.json(
      {
        error:
          status === 400
            ? "코드가 올바르지 않거나 만료되었습니다. 어르신 화면에서 새 코드를 받아 주세요."
            : "시니어를 연결하지 못했습니다.",
      },
      { status, headers: { "Cache-Control": "no-store" } },
    );
  }
}
