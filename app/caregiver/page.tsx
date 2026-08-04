import type { Metadata } from "next";
import CaregiverApp from "../../frontend/CaregiverApp";

export const metadata: Metadata = {
  title: "돌봄이 화면 | 실버렌즈",
  description: "시니어 돌봄이를 위한 실버렌즈 전용 화면",
};

export default function CaregiverPage() {
  return <CaregiverApp />;
}
