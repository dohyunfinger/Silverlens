import { NextRequest, NextResponse } from "next/server";
import { syncSeniorDevice } from "../../../../backend/services/careData";
import { isSameOriginMutation } from "../../../../backend/services/caregiverRequest";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!isSameOriginMutation(request)) {
    return NextResponse.json({ error: "허용되지 않은 요청입니다." }, { status: 403 });
  }
  try {
    const body = (await request.json()) as {
      deviceId?: unknown;
      deviceSecret?: unknown;
      displayName?: unknown;
      snapshot?: unknown;
    };
    if (typeof body.deviceId !== "string" || typeof body.deviceSecret !== "string") {
      return NextResponse.json({ error: "연결 정보가 없습니다." }, { status: 400 });
    }
    const result = await syncSeniorDevice({
      deviceId: body.deviceId,
      deviceSecret: body.deviceSecret,
      displayName: typeof body.displayName === "string" ? body.displayName : undefined,
      snapshot: body.snapshot,
    });
    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    const status = code === "INVALID_DEVICE_CREDENTIALS" ? 401 : code === "CARE_DATA_NOT_CONFIGURED" ? 503 : 500;
    return NextResponse.json(
      { error: status === 401 ? "저장된 연결 정보가 만료되었습니다." : "정보를 동기화하지 못했습니다." },
      { status, headers: { "Cache-Control": "no-store" } },
    );
  }
}
