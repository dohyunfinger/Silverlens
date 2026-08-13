import { NextRequest, NextResponse } from "next/server";
import {
  CAREGIVER_SESSION_COOKIE,
  createCaregiverSessionToken,
  isCaregiverServerAuthConfigured,
  isTemporaryAdminLoginConfigured,
  REMEMBERED_SESSION_SECONDS,
  STANDARD_SESSION_SECONDS,
  verifyCaregiverSessionToken,
  verifyFirebaseIdToken,
  verifyTemporaryAdminCredentials,
} from "../../../../backend/services/caregiverAuth";

export const dynamic = "force-dynamic";

function noStoreJson(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

function isSameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  return origin === new URL(request.url).origin;
}

export async function GET(request: NextRequest) {
  const configured =
    isCaregiverServerAuthConfigured() || isTemporaryAdminLoginConfigured();
  if (!configured) {
    return noStoreJson({ authenticated: false, configured: false });
  }

  const token = request.cookies.get(CAREGIVER_SESSION_COOKIE)?.value;
  if (!token) {
    return noStoreJson({
      authenticated: false,
      configured: true,
      temporaryAdminEnabled: isTemporaryAdminLoginConfigured(),
    });
  }

  try {
    const user = await verifyCaregiverSessionToken(token);
    return noStoreJson({
      authenticated: true,
      configured: true,
      temporaryAdminEnabled: isTemporaryAdminLoginConfigured(),
      user,
    });
  } catch {
    const response = noStoreJson({ authenticated: false, configured: true });
    response.cookies.set(CAREGIVER_SESSION_COOKIE, "", {
      httpOnly: true,
      maxAge: 0,
      path: "/",
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    });
    return response;
  }
}

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) {
    return noStoreJson({ error: "INVALID_ORIGIN" }, { status: 403 });
  }
  try {
    const body = (await request.json()) as {
      mode?: unknown;
      idToken?: unknown;
      username?: unknown;
      password?: unknown;
      remember?: unknown;
    };
    const maxAge =
      body.remember === true
        ? REMEMBERED_SESSION_SECONDS
        : STANDARD_SESSION_SECONDS;

    if (body.mode === "temporary-admin") {
      if (!isTemporaryAdminLoginConfigured()) {
        return noStoreJson(
          { error: "TEMP_ADMIN_NOT_CONFIGURED" },
          { status: 503 },
        );
      }
      const username =
        typeof body.username === "string" ? body.username.trim().slice(0, 100) : "";
      const password =
        typeof body.password === "string" ? body.password.slice(0, 200) : "";
      const user = await verifyTemporaryAdminCredentials(username, password);
      const sessionToken = await createCaregiverSessionToken(user, maxAge);
      const response = noStoreJson({ authenticated: true, user });
      response.cookies.set(CAREGIVER_SESSION_COOKIE, sessionToken, {
        httpOnly: true,
        maxAge,
        path: "/",
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
      });
      return response;
    }

    if (!isCaregiverServerAuthConfigured()) {
      return noStoreJson({ error: "AUTH_NOT_CONFIGURED" }, { status: 503 });
    }
    const idToken =
      typeof body.idToken === "string" ? body.idToken.trim() : "";
    if (!idToken || idToken.length > 12000) {
      return noStoreJson({ error: "INVALID_TOKEN" }, { status: 400 });
    }

    const user = await verifyFirebaseIdToken(idToken);
    const sessionToken = await createCaregiverSessionToken(user, maxAge);
    const response = noStoreJson({ authenticated: true, user });
    response.cookies.set(CAREGIVER_SESSION_COOKIE, sessionToken, {
      httpOnly: true,
      maxAge,
      path: "/",
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    });
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "EMAIL_NOT_VERIFIED") {
      return noStoreJson({ error: message }, { status: 403 });
    }
    if (message === "RECENT_LOGIN_REQUIRED") {
      return noStoreJson({ error: message }, { status: 401 });
    }
    if (message === "TEMP_ADMIN_INVALID_CREDENTIALS") {
      return noStoreJson({ error: message }, { status: 401 });
    }
    if (message === "TEMP_ADMIN_NOT_CONFIGURED") {
      return noStoreJson({ error: message }, { status: 503 });
    }
    return noStoreJson({ error: "INVALID_TOKEN" }, { status: 401 });
  }
}

export async function DELETE(request: NextRequest) {
  if (!isSameOrigin(request)) {
    return noStoreJson({ error: "INVALID_ORIGIN" }, { status: 403 });
  }
  const response = noStoreJson({ authenticated: false });
  response.cookies.set(CAREGIVER_SESSION_COOKIE, "", {
    httpOnly: true,
    maxAge: 0,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
  return response;
}
