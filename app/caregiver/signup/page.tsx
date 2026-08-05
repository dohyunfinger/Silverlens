import type { Metadata } from "next";
import CaregiverSignup from "../../../frontend/CaregiverSignup";

export const metadata: Metadata = {
  title: "돌봄이 회원가입 | SilverLens",
  description: "SilverLens에서 어르신과 안전하게 연결할 돌봄이 계정 만들기",
};

export default function CaregiverSignupPage() {
  return <CaregiverSignup />;
}
