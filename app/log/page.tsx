import { notFound } from "next/navigation";
import { isDataLogEnabled } from "../../backend/config/env";
import DataLogView from "../../frontend/DataLogView";

export const metadata = {
  title: "SilverLens 데이터 점검 (임시)",
};

// 환경변수를 요청 시점에 읽어야 하므로 정적으로 미리 만들지 않는다.
export const dynamic = "force-dynamic";

export default function DataLogPage() {
  // 화면 자체도 API와 같은 기준으로 닫는다. 예전에는 /api/log 만 닫혀 있어서
  // 화면은 그대로 뜨고 "불러오지 못했습니다"만 보였다.
  if (!isDataLogEnabled()) notFound();
  return <DataLogView />;
}
