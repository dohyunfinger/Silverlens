import {
  createRemoteJWKSet,
  jwtVerify,
  SignJWT,
  type JWTPayload,
} from "jose";

export const CAREGIVER_SESSION_COOKIE = "sl_caregiver_session";
export const REMEMBERED_SESSION_SECONDS = 60 * 60 * 24 * 14;
export const STANDARD_SESSION_SECONDS = 60 * 60 * 12;

const FIREBASE_JWKS = createRemoteJWKSet(
  new URL(
    "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com",
  ),
);

export type CaregiverSessionUser = {
  uid: string;
  email: string;
  name: string;
  picture: string;
  provider: string;
};

type FirebaseClaims = JWTPayload & {
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
  provider?: string;
  auth_time?: number;
  firebase?: {
    sign_in_provider?: string;
  };
};

function firebaseProjectId() {
  return process.env.FIREBASE_PROJECT_ID?.trim() ?? "";
}

function sessionSecret() {
  return process.env.AUTH_SESSION_SECRET?.trim() ?? "";
}

function encodedSessionSecret() {
  const secret = sessionSecret();
  if (secret.length < 32) {
    throw new Error("AUTH_SESSION_SECRET must be at least 32 characters.");
  }
  return new TextEncoder().encode(secret);
}

export function isCaregiverServerAuthConfigured() {
  return Boolean(firebaseProjectId() && sessionSecret().length >= 32);
}

function claimsToUser(payload: FirebaseClaims): CaregiverSessionUser {
  const uid = typeof payload.sub === "string" ? payload.sub.trim() : "";
  const email = typeof payload.email === "string" ? payload.email.trim() : "";
  if (!uid || !email) throw new Error("Invalid Firebase identity claims.");

  return {
    uid,
    email,
    name:
      typeof payload.name === "string" && payload.name.trim()
        ? payload.name.trim().slice(0, 80)
        : email.split("@")[0],
    picture:
      typeof payload.picture === "string"
        ? payload.picture.trim().slice(0, 800)
        : "",
    provider:
      payload.firebase?.sign_in_provider?.trim() ||
      payload.provider?.trim() ||
      "unknown",
  };
}

export async function verifyFirebaseIdToken(idToken: string) {
  const projectId = firebaseProjectId();
  if (!projectId) throw new Error("Firebase project is not configured.");

  const { payload } = await jwtVerify(idToken, FIREBASE_JWKS, {
    algorithms: ["RS256"],
    audience: projectId,
    issuer: `https://securetoken.google.com/${projectId}`,
  });
  const claims = payload as FirebaseClaims;

  if (claims.email_verified !== true) {
    throw new Error("EMAIL_NOT_VERIFIED");
  }

  const authTime = Number(claims.auth_time);
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(authTime) || now - authTime > 5 * 60) {
    throw new Error("RECENT_LOGIN_REQUIRED");
  }

  return claimsToUser(claims);
}

export async function createCaregiverSessionToken(
  user: CaregiverSessionUser,
  maxAgeSeconds: number,
) {
  return new SignJWT({
    email: user.email,
    name: user.name,
    picture: user.picture,
    provider: user.provider,
    role: "caregiver",
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer("silverlens")
    .setAudience("silverlens-caregiver")
    .setSubject(user.uid)
    .setIssuedAt()
    .setExpirationTime(`${maxAgeSeconds}s`)
    .sign(encodedSessionSecret());
}

export async function verifyCaregiverSessionToken(token: string) {
  const { payload } = await jwtVerify(token, encodedSessionSecret(), {
    algorithms: ["HS256"],
    audience: "silverlens-caregiver",
    issuer: "silverlens",
  });

  if (payload.role !== "caregiver") throw new Error("Invalid session role.");
  return claimsToUser(payload as FirebaseClaims);
}
