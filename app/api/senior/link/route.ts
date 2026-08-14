import { NextRequest, NextResponse } from "next/server";
import {
  issueLinkCode,
  type LinkCodeLanguage,
} from "../../../../backend/services/careData";
import { isSameOriginMutation } from "../../../../backend/services/caregiverRequest";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!isSameOriginMutation(request)) {
    return NextResponse.json({ error: "허용되지 않은 요청입니다." }, { status: 403 });
  }
  try {
    const body = (await request.json()) as {
      deviceId?: string;
      deviceSecret?: string;
      displayName?: string;
      language?: LinkCodeLanguage;
      snapshot?: unknown;
    };
    const result = await issueLinkCode({
      deviceId: body.deviceId,
      deviceSecret: body.deviceSecret,
      displayName: body.displayName,
      language: body.language,
      snapshot: body.snapshot,
    });
    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    const status = code === "INVALID_DEVICE_CREDENTIALS" ? 401 : code === "CARE_DATA_NOT_CONFIGURED" ? 503 : 500;
    return NextResponse.json(
      {
        error:
          status === 401
            ? "이 기기의 연결 정보가 올바르지 않습니다."
            : status === 503
              ? "연결 코드 저장소가 아직 준비되지 않았습니다."
              : "연결 코드를 만들지 못했습니다. 잠시 후 다시 시도해 주세요.",
      },
      { status, headers: { "Cache-Control": "no-store" } },
    );
  }
}
