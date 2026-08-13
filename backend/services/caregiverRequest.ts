import type { NextRequest } from "next/server";
import {
  CAREGIVER_SESSION_COOKIE,
  verifyCaregiverSessionToken,
} from "./caregiverAuth";

export function isSameOriginMutation(request: NextRequest) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

export async function caregiverFromRequest(request: NextRequest) {
  const token = request.cookies.get(CAREGIVER_SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifyCaregiverSessionToken(token).catch(() => null);
}
