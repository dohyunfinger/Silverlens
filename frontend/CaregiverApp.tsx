"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";
import Link from "next/link";

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function MicrophoneIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="9" y="3" width="6" height="12" rx="3" />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3M9 21h6" />
    </svg>
  );
}

function WaveformIcon() {
  return (
    <svg viewBox="0 0 28 28" aria-hidden="true">
      <path d="M5 12v4M9.5 8v12M14 5v18M18.5 9v10M23 12v4" />
    </svg>
  );
}

export default function CaregiverApp() {
  const [question, setQuestion] = useState("");
  const [isToolMenuOpen, setIsToolMenuOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const composerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!isToolMenuOpen) return;

    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!composerRef.current?.contains(event.target as Node)) {
        setIsToolMenuOpen(false);
      }
    };

    window.addEventListener("pointerdown", closeOnOutsideClick);
    return () => window.removeEventListener("pointerdown", closeOnOutsideClick);
  }, [isToolMenuOpen]);

  const showPreparationNotice = (message: string) => {
    setIsToolMenuOpen(false);
    setNotice(message);
    window.setTimeout(() => setNotice(""), 3200);
  };

  const submitQuestion = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!question.trim()) {
      inputRef.current?.focus();
      return;
    }

    showPreparationNotice("돌봄 상담 기능은 다음 단계에서 연결할 예정입니다.");
  };

  return (
    <main className="caregiver-root">
      <header className="caregiver-header">
        <Link className="caregiver-brand" href="/" aria-label="실버렌즈 시니어 화면으로 이동">
          <span className="caregiver-brand-mark">SL</span>
          <span>SilverLens</span>
          <span className="caregiver-mode-badge">돌봄이</span>
        </Link>
        <Link className="caregiver-back-link" href="/">
          시니어 화면으로 돌아가기
          <span aria-hidden="true">↗</span>
        </Link>
      </header>

      <section className="caregiver-hero" aria-labelledby="caregiver-heading">
        <div className="caregiver-heading-group">
          <p>돌봄이 전용 도우미</p>
          <h1 id="caregiver-heading">오늘 어떤 돌봄이 필요하신가요?</h1>
          <span>식사, 복약, 건강 상태와 돌봄 기록을 편하게 물어보세요.</span>
        </div>

        <form className="caregiver-composer" onSubmit={submitQuestion}>
          <div className="caregiver-composer-inner" ref={composerRef}>
            <button
              type="button"
              className="caregiver-tool-button"
              aria-label="추가 도구 열기"
              aria-expanded={isToolMenuOpen}
              onClick={() => setIsToolMenuOpen((open) => !open)}
            >
              <PlusIcon />
            </button>

            {isToolMenuOpen && (
              <div className="caregiver-tool-menu" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => showPreparationNotice("사진 첨부 기능은 다음 단계에서 연결할 예정입니다.")}
                >
                  <span aria-hidden="true">▧</span>
                  사진 첨부
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => showPreparationNotice("돌봄 기록 기능은 다음 단계에서 연결할 예정입니다.")}
                >
                  <span aria-hidden="true">≡</span>
                  돌봄 기록
                </button>
              </div>
            )}

            <input
              ref={inputRef}
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="돌봄에 관해 무엇이든 물어보세요"
              aria-label="돌봄 질문"
              autoComplete="off"
            />

            <button
              type="button"
              className="caregiver-mic-button"
              aria-label="음성으로 질문하기"
              onClick={() => showPreparationNotice("음성 입력은 다음 단계에서 연결할 예정입니다.")}
            >
              <MicrophoneIcon />
            </button>
            <button
              type="submit"
              className="caregiver-submit-button"
              aria-label="질문 보내기"
              disabled={!question.trim()}
            >
              <WaveformIcon />
            </button>
          </div>
        </form>

        <p className="caregiver-notice" role="status" aria-live="polite">
          {notice}
        </p>
      </section>

      <footer className="caregiver-footer">
        <span>SilverLens Care</span>
        <span>돌봄 판단을 돕는 참고 도구이며, 의료진의 진단을 대신하지 않습니다.</span>
      </footer>
    </main>
  );
}
