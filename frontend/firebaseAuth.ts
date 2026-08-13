import { getApp, getApps, initializeApp, type FirebaseOptions } from "firebase/app";
import {
  browserSessionPersistence,
  getAuth,
  setPersistence,
  type Auth,
  type User,
} from "firebase/auth";
import type { CaregiverSessionUser } from "../backend/services/caregiverAuth";

type AuthConfigResponse = {
  configured: boolean;
  config?: FirebaseOptions;
};

type SessionResponse = {
  authenticated: boolean;
  configured?: boolean;
  user?: CaregiverSessionUser;
  error?: string;
};

let authPromise: Promise<Auth> | null = null;

export class CaregiverAuthError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "CaregiverAuthError";
  }
}

export function getAuthErrorCode(error: unknown) {
  if (error instanceof CaregiverAuthError) return error.code;
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code;
  }
  return "unknown";
}

export function getCaregiverAuth() {
  if (!authPromise) {
    authPromise = fetch("/api/auth/config", {
      cache: "no-store",
      credentials: "same-origin",
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("인증 설정을 불러오지 못했습니다.");
        return (await response.json()) as AuthConfigResponse;
      })
      .then(async ({ configured, config }) => {
        if (!configured || !config) {
          throw new CaregiverAuthError(
            "auth/not-configured",
            "로그인 서비스 설정이 아직 완료되지 않았습니다.",
          );
        }
        const app = getApps().some((item) => item.name === "caregiver-auth")
          ? getApp("caregiver-auth")
          : initializeApp(config, "caregiver-auth");
        const auth = getAuth(app);
        auth.languageCode = "ko";
        await setPersistence(auth, browserSessionPersistence);
        return auth;
      })
      .catch((error) => {
        authPromise = null;
        throw error;
      });
  }
  return authPromise;
}

export async function createServerSession(user: User, remember: boolean) {
  const idToken = await user.getIdToken(true);
  const response = await fetch("/api/auth/session", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ idToken, remember }),
  });
  const payload = (await response.json()) as SessionResponse;
  if (!response.ok || !payload.authenticated || !payload.user) {
    throw new CaregiverAuthError(
      payload.error ?? "auth/session-failed",
      "로그인 상태를 안전하게 저장하지 못했습니다.",
    );
  }
  return payload.user;
}

export async function clearServerSession() {
  await fetch("/api/auth/session", {
    method: "DELETE",
    credentials: "same-origin",
  });
}
