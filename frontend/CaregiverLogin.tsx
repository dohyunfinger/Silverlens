"use client";

import Link from "next/link";
import { type FormEvent, useState } from "react";

export default function CaregiverLogin() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [keepSignedIn, setKeepSignedIn] = useState(true);
  const [notice, setNotice] = useState("");

  const showPreparationNotice = (message: string) => {
    setNotice(message);
  };

  const submitEmailLogin = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    showPreparationNotice(
      "이메일 로그인은 인증 서비스 연결 후 사용할 수 있습니다. 입력한 정보는 저장되지 않았습니다.",
    );
  };

  return (
    <main className="caregiver-login-root">
      <header className="caregiver-login-header">
        <Link
          className="caregiver-brand"
          href="/"
          aria-label="SilverLens 시니어 화면으로 이동"
        >
          <span className="caregiver-brand-mark">SL</span>
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
          <h1>어르신의 일상을<br />더 세심하게 살펴보세요</h1>
          <p className="caregiver-login-description">
            연결된 어르신의 건강정보와 최근 대화를 확인하고,
            필요한 돌봄 내용을 한곳에서 관리할 수 있습니다.
          </p>

          <ul className="caregiver-login-benefits" aria-label="돌봄이 서비스 주요 기능">
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

        <section className="caregiver-login-card" aria-labelledby="caregiver-login-title">
          <div className="caregiver-login-card-heading">
            <span className="caregiver-login-card-mark" aria-hidden="true">SL</span>
            <div>
              <p>돌봄이 전용</p>
              <h2 id="caregiver-login-title">로그인</h2>
            </div>
          </div>

          <p className="caregiver-login-card-copy">
            등록한 계정으로 로그인하면 연결된 어르신을 계속 확인할 수 있습니다.
          </p>

          <button
            className="caregiver-google-button"
            type="button"
            onClick={() =>
              showPreparationNotice(
                "Google 로그인은 인증 서비스 연결 후 사용할 수 있습니다.",
              )
            }
          >
            <span className="caregiver-google-mark" aria-hidden="true">G</span>
            Google로 계속하기
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
              required
            />

            <div className="caregiver-password-label">
              <label htmlFor="caregiver-password">비밀번호</label>
              <button
                type="button"
                onClick={() =>
                  showPreparationNotice(
                    "비밀번호 찾기는 이메일 인증 연결 후 사용할 수 있습니다.",
                  )
                }
              >
                비밀번호 찾기
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
                minLength={8}
                required
              />
              <button
                type="button"
                aria-label={showPassword ? "비밀번호 숨기기" : "비밀번호 보기"}
                aria-pressed={showPassword}
                onClick={() => setShowPassword((visible) => !visible)}
              >
                {showPassword ? "숨기기" : "보기"}
              </button>
            </div>

            <label className="caregiver-remember-option">
              <input
                type="checkbox"
                checked={keepSignedIn}
                onChange={(event) => setKeepSignedIn(event.target.checked)}
              />
              <span>이 기기에서 로그인 상태 유지</span>
            </label>

            <button className="caregiver-email-submit" type="submit">
              로그인
            </button>
          </form>

          <p
            className={`caregiver-login-status${notice ? " is-visible" : ""}`}
            role="status"
            aria-live="polite"
          >
            {notice}
          </p>

          <p className="caregiver-signup-prompt">
            처음 이용하시나요?
            <button
              type="button"
              onClick={() =>
                showPreparationNotice(
                  "회원가입 화면은 다음 단계에서 연결할 예정입니다.",
                )
              }
            >
              회원가입
            </button>
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
