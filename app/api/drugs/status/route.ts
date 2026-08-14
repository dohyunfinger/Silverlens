import { NextResponse } from "next/server";
import { getMfdsCatalogStatus } from "../../../../backend/services/mfdsPillData";

export const dynamic = "force-dynamic";

/** 키 값은 노출하지 않고 배포 데이터 준비 상태만 확인한다. */
export async function GET() {
  const status = await getMfdsCatalogStatus();
  return NextResponse.json(status, {
    headers: { "Cache-Control": "no-store" },
  });
}
