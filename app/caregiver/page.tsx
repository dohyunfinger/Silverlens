import type { Metadata } from "next";
import CaregiverLogin from "../../frontend/CaregiverLogin";

export const metadata: Metadata = {
  title: "돌봄이 로그인 | SilverLens",
  description: "연결된 어르신을 안전하게 돌보기 위한 SilverLens 돌봄이 로그인",
};

export default function CaregiverPage() {
  return <CaregiverLogin />;
}
