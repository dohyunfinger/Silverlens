import { NextResponse } from "next/server";
import {
  isCaregiverServerAuthConfigured,
  isTemporaryAdminLoginConfigured,
} from "../../../../backend/services/caregiverAuth";

export const dynamic = "force-dynamic";

export async function GET() {
  const config = {
    apiKey: process.env.FIREBASE_API_KEY?.trim() ?? "",
    authDomain: process.env.FIREBASE_AUTH_DOMAIN?.trim() ?? "",
    projectId: process.env.FIREBASE_PROJECT_ID?.trim() ?? "",
    appId: process.env.FIREBASE_APP_ID?.trim() ?? "",
  };
  const configured =
    Object.values(config).every(Boolean) && isCaregiverServerAuthConfigured();

  return NextResponse.json(
    configured
      ? {
          configured,
          config,
          temporaryAdminEnabled: isTemporaryAdminLoginConfigured(),
        }
      : {
          configured: false,
          temporaryAdminEnabled: isTemporaryAdminLoginConfigured(),
        },
    { headers: { "Cache-Control": "no-store" } },
  );
}
