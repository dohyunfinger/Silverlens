"use client";

import Link from "next/link";
import { type FormEvent, useState } from "react";
import {
  createUserWithEmailAndPassword,
  sendEmailVerification,
  signOut,
  updateProfile,
  type Auth,
} from "firebase/auth";
import { getAuthErrorCode, getCaregiverAuth } from "./firebaseAuth";

function signupErrorMessage(error: unknown) {
  switch (getAuthErrorCode(error)) {
    case "auth/not-configured":
      return "회원가입 서비스 연결에 필요한 Firebase 설정이 아직 완료되지 않았습니다.";
    case "auth/invalid-email":
      return "이메일 주소 형식을 확인해주세요.";
    case "auth/email-already-in-use":
      return "이 이메일로 가입할 수 없습니다. 로그인이나 비밀번호 찾기를 이용해주세요.";
    case "auth/weak-password":
      return "더 안전한 비밀번호를 사용해주세요.";
    case "auth/network-request-failed":
      return "인터넷 연결을 확인한 뒤 다시 시도해주세요.";
    case "auth/too-many-requests":
      return "가입 시도가 많아 잠시 제한되었습니다. 잠시 후 다시 시도해주세요.";
    case "auth/operation-not-allowed":
      return "이메일 회원가입이 아직 활성화되지 않았습니다.";
    default:
      return "회원가입을 완료하지 못했습니다. 잠시 후 다시 시도해주세요.";
  }
}

export default function CaregiverSignup() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [agreePrivacy, setAgreePrivacy] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [completedEmail, setCompletedEmail] = useState("");

  const submitSignup = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage("");

    if (name.trim().length < 2) {
      setErrorMessage("이름을 두 글자 이상 입력해주세요.");
      return;
    }
    if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
      setErrorMessage("비밀번호는 영문과 숫자를 포함해 8자 이상 입력해주세요.");
      return;
    }
    if (password !== passwordConfirm) {
      setErrorMessage("비밀번호 확인이 일치하지 않습니다.");
      return;
    }
    if (!agreeTerms || !agreePrivacy) {
      setErrorMessage("필수 동의 항목을 확인해주세요.");
      return;
    }

    setIsSubmitting(true);
    let auth: Auth | null = null;
    try {
      auth = await getCaregiverAuth();
      const credential = await createUserWithEmailAndPassword(
        auth,
        email.trim(),
        password,
      );
      await updateProfile(credential.user, { displayName: name.trim() });
      await sendEmailVerification(credential.user);
      const registeredEmail = credential.user.email ?? email.trim();
      await signOut(auth);
      setCompletedEmail(registeredEmail);
    } catch (error) {
      setErrorMessage(signupErrorMessage(error));
    } finally {
      if (auth?.currentUser) await signOut(auth).catch(() => undefined);
      setIsSubmitting(false);
    }
  };

  return (
    <main className="caregiver-login-root caregiver-signup-root">
      <header className="caregiver-login-header">
        <Link className="caregiver-brand" href="/" aria-label="SilverLens 시니어 화면으로 이동">
          <span className="caregiver-brand-mark">SL</span>
          <span>SilverLens</span>
          <span className="caregiver-mode-badge">돌봄이</span>
        </Link>
        <Link className="caregiver-back-link" href="/caregiver">
          로그인으로 돌아가기
          <span aria-hidden="true">→</span>
        </Link>
      </header>

      <section className="caregiver-signup-layout">
        <section className="caregiver-login-card caregiver-signup-card" aria-labelledby="caregiver-signup-title">
          {completedEmail ? (
            <div className="caregiver-signup-complete" role="status">
              <span className="caregiver-signup-check" aria-hidden="true">✓</span>
              <p>회원가입 완료</p>
              <h1>이메일을 확인해주세요</h1>
              <span>
                <strong>{completedEmail}</strong>으로 인증 메일을 보냈습니다.
                메일의 링크를 누른 뒤 로그인해주세요.
              </span>
              <Link className="caregiver-email-submit" href="/caregiver">
                로그인 화면으로 이동
              </Link>
            </div>
          ) : (
            <>
              <div className="caregiver-login-card-heading">
                <span className="caregiver-login-card-mark" aria-hidden="true">SL</span>
                <div>
                  <p>돌봄이 전용</p>
                  <h1 id="caregiver-signup-title">회원가입</h1>
                </div>
              </div>
              <p className="caregiver-login-card-copy">
                돌봄이 계정을 만든 뒤 어르신의 연결 코드를 등록할 수 있습니다.
              </p>

              <form className="caregiver-signup-form" onSubmit={submitSignup} aria-busy={isSubmitting}>
                <label htmlFor="caregiver-signup-name">이름</label>
                <input
                  id="caregiver-signup-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  autoComplete="name"
                  maxLength={50}
                  placeholder="돌봄이 이름"
                  disabled={isSubmitting}
                  required
                />

                <label htmlFor="caregiver-signup-email">이메일</label>
                <input
                  id="caregiver-signup-email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoComplete="email"
                  placeholder="name@example.com"
                  disabled={isSubmitting}
                  required
                />

                <label htmlFor="caregiver-signup-password">비밀번호</label>
                <div className="caregiver-password-field">
                  <input
                    id="caregiver-signup-password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    autoComplete="new-password"
                    placeholder="영문·숫자 포함 8자 이상"
                    disabled={isSubmitting}
                    minLength={8}
                    required
                  />
                  <button
                    type="button"
                    aria-label={showPassword ? "비밀번호 숨기기" : "비밀번호 보기"}
                    aria-pressed={showPassword}
                    onClick={() => setShowPassword((visible) => !visible)}
                    disabled={isSubmitting}
                  >
                    {showPassword ? "숨기기" : "보기"}
                  </button>
                </div>

                <label htmlFor="caregiver-signup-password-confirm">비밀번호 확인</label>
                <input
                  id="caregiver-signup-password-confirm"
                  type={showPassword ? "text" : "password"}
                  value={passwordConfirm}
                  onChange={(event) => setPasswordConfirm(event.target.value)}
                  autoComplete="new-password"
                  placeholder="비밀번호를 다시 입력하세요"
                  disabled={isSubmitting}
                  minLength={8}
                  required
                />

                <div className="caregiver-signup-agreements">
                  <label>
                    <input
                      type="checkbox"
                      checked={agreeTerms}
                      onChange={(event) => setAgreeTerms(event.target.checked)}
                      disabled={isSubmitting}
                      required
                    />
                    <span><strong>필수</strong> 서비스 이용약관에 동의합니다.</span>
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={agreePrivacy}
                      onChange={(event) => setAgreePrivacy(event.target.checked)}
                      disabled={isSubmitting}
                      required
                    />
                    <span><strong>필수</strong> 개인정보 수집 및 이용에 동의합니다.</span>
                  </label>
                </div>

                {errorMessage && (
                  <p className="caregiver-login-status is-visible is-error" role="alert">
                    {errorMessage}
                  </p>
                )}

                <button className="caregiver-email-submit" type="submit" disabled={isSubmitting}>
                  {isSubmitting ? "계정을 만들고 있어요..." : "회원가입"}
                </button>
              </form>

              <p className="caregiver-signup-prompt">
                이미 계정이 있나요?
                <Link href="/caregiver">로그인</Link>
              </p>
            </>
          )}
        </section>
      </section>

      <footer className="caregiver-login-footer">
        <span>SilverLens Care</span>
        <p>계정 정보는 로그인과 돌봄 연결 관리에만 사용됩니다.</p>
      </footer>
    </main>
  );
}
