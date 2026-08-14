"use client";

import Link from "next/link";
import { type FormEvent, useState } from "react";
import {
  GoogleAuthProvider,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  type Auth,
  type User,
} from "firebase/auth";
import type { CaregiverSessionUser } from "../backend/services/caregiverAuth";
import {
  createServerSession,
  getAuthErrorCode,
  getCaregiverAuth,
} from "./firebaseAuth";

type CaregiverLoginProps = {
  onAuthenticated: (user: CaregiverSessionUser) => void;
};

function loginErrorMessage(error: unknown) {
  switch (getAuthErrorCode(error)) {
    case "auth/not-configured":
    case "AUTH_NOT_CONFIGURED":
      return "로그인 서비스 연결에 필요한 Firebase 설정이 아직 완료되지 않았습니다.";
    case "auth/invalid-email":
      return "이메일 주소 형식을 확인해주세요.";
    case "auth/invalid-credential":
    case "auth/user-disabled":
      return "이메일 또는 비밀번호를 확인해주세요.";
    case "auth/popup-closed-by-user":
      return "Google 로그인 창이 닫혔습니다. 다시 시도해주세요.";
    case "auth/popup-blocked":
      return "로그인 창이 차단되었습니다. 브라우저에서 팝업을 허용해주세요.";
    case "auth/network-request-failed":
      return "인터넷 연결을 확인한 뒤 다시 시도해주세요.";
    case "auth/too-many-requests":
      return "로그인 시도가 많아 잠시 제한되었습니다. 잠시 후 다시 시도해주세요.";
    case "auth/operation-not-allowed":
      return "이 로그인 방식이 아직 활성화되지 않았습니다.";
    case "EMAIL_NOT_VERIFIED":
      return "이메일 인증이 필요합니다. 받은편지함의 인증 링크를 확인해주세요.";
    case "RECENT_LOGIN_REQUIRED":
      return "안전을 위해 다시 로그인해주세요.";
    default:
      return "로그인하지 못했습니다. 잠시 후 다시 시도해주세요.";
  }
}

export default function CaregiverLogin({
  onAuthenticated,
}: CaregiverLoginProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [keepSignedIn, setKeepSignedIn] = useState(true);
  const [notice, setNotice] = useState("");
  const [noticeKind, setNoticeKind] = useState<"info" | "error">("info");
  const [pendingAction, setPendingAction] = useState<
    "google" | "email" | "reset" | null
  >(null);

  const showNotice = (message: string, kind: "info" | "error" = "info") => {
    setNotice(message);
    setNoticeKind(kind);
  };

  const finishLogin = async (user: User, auth: Auth) => {
    if (!user.emailVerified) {
      await sendEmailVerification(user).catch(() => undefined);
      await signOut(auth);
      throw Object.assign(new Error("Email verification required"), {
        code: "EMAIL_NOT_VERIFIED",
      });
    }

    const sessionUser = await createServerSession(user, keepSignedIn);
    await signOut(auth);
    onAuthenticated(sessionUser);
  };

  const startGoogleLogin = async () => {
    setPendingAction("google");
    setNotice("");
    let auth: Auth | null = null;
    try {
      auth = await getCaregiverAuth();
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      const credential = await signInWithPopup(auth, provider);
      await finishLogin(credential.user, auth);
    } catch (error) {
      showNotice(loginErrorMessage(error), "error");
    } finally {
      if (auth?.currentUser) await signOut(auth).catch(() => undefined);
      setPendingAction(null);
    }
  };

  const submitEmailLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPendingAction("email");
    setNotice("");
    let auth: Auth | null = null;
    try {
      auth = await getCaregiverAuth();
      const credential = await signInWithEmailAndPassword(
        auth,
        email.trim(),
        password,
      );
      await finishLogin(credential.user, auth);
    } catch (error) {
      showNotice(loginErrorMessage(error), "error");
    } finally {
      if (auth?.currentUser) await signOut(auth).catch(() => undefined);
      setPendingAction(null);
    }
  };

  const resetPassword = async () => {
    const cleanedEmail = email.trim();
    if (!cleanedEmail) {
      showNotice("위 이메일 칸에 가입한 이메일을 먼저 입력해주세요.", "error");
      return;
    }

    setPendingAction("reset");
    setNotice("");
    try {
      const auth = await getCaregiverAuth();
      await sendPasswordResetEmail(auth, cleanedEmail);
      showNotice(
        "가입된 이메일이라면 비밀번호 재설정 안내를 보내드렸습니다.",
      );
    } catch (error) {
      const code = getAuthErrorCode(error);
      showNotice(
        code === "auth/invalid-email"
          ? "이메일 주소 형식을 확인해주세요."
          : loginErrorMessage(error),
        "error",
      );
    } finally {
      setPendingAction(null);
    }
  };

  const isBusy = pendingAction !== null;

  return (
    <main className="caregiver-login-root">
      <header className="caregiver-login-header">
        <Link
          className="caregiver-brand"
          href="/"
          aria-label="SilverLens 시니어 화면으로 이동"
        >
          <span className="caregiver-brand-mark">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/silverlens-mark.png" alt="" />
          </span>
          <span>SilverLens</span>
          <span className="caregiver-mode-badge">돌봄이</span>
        </Link>

        <Link className="caregiver-back-link" href="/">
          시니어 화면으로 돌아가기
          <span aria-hidden="true">→</span>
        </Link>
      </header>

      <section className="caregiver-login-layout">
        <div className="caregiver-login-intro">
          <p className="caregiver-login-eyebrow">SILVERLENS CARE</p>
          <h1>
            어르신의 일상을
            <br />더 세심하게 살펴보세요
          </h1>
          <p className="caregiver-login-description">
            연결된 어르신의 건강정보와 최근 대화를 확인하고, 필요한 돌봄
            내용을 한곳에서 관리할 수 있습니다.
          </p>

          <ul
            className="caregiver-login-benefits"
            aria-label="돌봄이 서비스 주요 기능"
          >
            <li>
              <span aria-hidden="true">01</span>
              <div>
                <strong>건강정보 확인</strong>
                <p>복용약, 알레르기와 주의사항을 빠르게 확인합니다.</p>
              </div>
            </li>
            <li>
              <span aria-hidden="true">02</span>
              <div>
                <strong>안전한 연결</strong>
                <p>어르신이 알려준 일회용 코드로만 연결할 수 있습니다.</p>
              </div>
            </li>
          </ul>
        </div>

        <section
          className="caregiver-login-card"
          aria-labelledby="caregiver-login-title"
          aria-busy={isBusy}
        >
          <div className="caregiver-login-card-heading">
            <span className="caregiver-login-card-mark" aria-hidden="true">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/brand/silverlens-mark.png" alt="" />
            </span>
            <div>
              <p>돌봄이 전용</p>
              <h2 id="caregiver-login-title">로그인</h2>
            </div>
          </div>

          <p className="caregiver-login-card-copy">
            등록한 계정으로 로그인하면 연결된 어르신을 계속 확인할 수
            있습니다.
          </p>

          <button
            className="caregiver-google-button"
            type="button"
            onClick={startGoogleLogin}
            disabled={isBusy}
          >
            <span className="caregiver-google-mark" aria-hidden="true">
              G
            </span>
            {pendingAction === "google" ? "Google 확인 중..." : "Google로 계속하기"}
          </button>

          <div className="caregiver-login-divider" aria-hidden="true">
            <span />
            <em>또는</em>
            <span />
          </div>

          <form className="caregiver-email-login" onSubmit={submitEmailLogin}>
            <label htmlFor="caregiver-email">이메일</label>
            <input
              id="caregiver-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="name@example.com"
              autoComplete="email"
              disabled={isBusy}
              required
            />

            <div className="caregiver-password-label">
              <label htmlFor="caregiver-password">비밀번호</label>
              <button
                type="button"
                onClick={resetPassword}
                disabled={isBusy}
              >
                {pendingAction === "reset" ? "전송 중..." : "비밀번호 찾기"}
              </button>
            </div>

            <div className="caregiver-password-field">
              <input
                id="caregiver-password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="비밀번호를 입력하세요"
                autoComplete="current-password"
                disabled={isBusy}
                minLength={8}
                required
              />
              <button
                type="button"
                aria-label={showPassword ? "비밀번호 숨기기" : "비밀번호 보기"}
                aria-pressed={showPassword}
                onClick={() => setShowPassword((visible) => !visible)}
                disabled={isBusy}
              >
                {showPassword ? "숨기기" : "보기"}
              </button>
            </div>

            <label className="caregiver-remember-option">
              <input
                type="checkbox"
                checked={keepSignedIn}
                onChange={(event) => setKeepSignedIn(event.target.checked)}
                disabled={isBusy}
              />
              <span>이 기기에서 14일간 로그인 유지</span>
            </label>

            <button
              className="caregiver-email-submit"
              type="submit"
              disabled={isBusy}
            >
              {pendingAction === "email" ? "로그인 중..." : "로그인"}
            </button>
          </form>

          <p
            className={`caregiver-login-status${notice ? " is-visible" : ""}${
              noticeKind === "error" ? " is-error" : ""
            }`}
            role={noticeKind === "error" ? "alert" : "status"}
            aria-live="polite"
          >
            {notice}
          </p>

          <p className="caregiver-signup-prompt">
            처음 이용하시나요?
            <Link href="/caregiver/signup">회원가입</Link>
          </p>
        </section>
      </section>

      <footer className="caregiver-login-footer">
        <span>SilverLens Care</span>
        <p>어르신이 허용한 정보만 돌봄이에게 공유됩니다.</p>
      </footer>
    </main>
  );
}
