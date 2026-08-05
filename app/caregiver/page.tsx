import type { Metadata } from "next";
import { cookies } from "next/headers";
import {
  CAREGIVER_SESSION_COOKIE,
  isCaregiverServerAuthConfigured,
  verifyCaregiverSessionToken,
} from "../../backend/services/caregiverAuth";
import CaregiverPortal from "../../frontend/CaregiverPortal";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "돌봄이 로그인 | SilverLens",
  description: "연결된 어르신을 안전하게 돌보기 위한 SilverLens 돌봄이 로그인",
};

export default async function CaregiverPage() {
  let user = null;
  if (isCaregiverServerAuthConfigured()) {
    const cookieStore = await cookies();
    const sessionToken = cookieStore.get(CAREGIVER_SESSION_COOKIE)?.value;
    if (sessionToken) {
      user = await verifyCaregiverSessionToken(sessionToken).catch(() => null);
    }
  }

  return <CaregiverPortal initialUser={user} />;
}
