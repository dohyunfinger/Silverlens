"use client";

import Link from "next/link";
import {
  type FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import ReactMarkdown from "react-markdown";
import { readStore } from "./localStore";

type RiskLevel = "danger" | "caution" | "safe";
type TurnStatus = "loading" | "complete" | "error";

type CaregiverTurn = {
  id: string;
  question: string;
  answer: string;
  riskLevel: RiskLevel;
  warningMessage: string;
  status: TurnStatus;
  errorMessage: string;
};

type StoredHealthNote = {
  kind: "allergy" | "condition" | "setup";
  text: string;
};

type StoredState = {
  profile?: {
    gender?: "male" | "female" | null;
    ageBand?: number;
    ageConfirmed?: boolean;
    allergyIds?: string[];
    conditionIds?: string[];
    healthNotes?: StoredHealthNote[];
  };
};

type CaregiverProfile = {
  audience: "caregiver";
  language: string;
  gender?: "male" | "female";
  ageBand?: number;
  allergyIds: string[];
  conditionIds: string[];
  healthNotes: StoredHealthNote[];
};

const EMPTY_PROFILE: CaregiverProfile = {
  audience: "caregiver",
  language: "ko-KR",
  allergyIds: [],
  conditionIds: [],
  healthNotes: [],
};

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function healthNotes(value: unknown): StoredHealthNote[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is StoredHealthNote =>
      Boolean(item) &&
      typeof item === "object" &&
      typeof (item as StoredHealthNote).text === "string" &&
      ["allergy", "condition", "setup"].includes(
        (item as StoredHealthNote).kind,
      ),
  );
}

function profileFromStoredState(state: StoredState | null): CaregiverProfile {
  const profile = state?.profile;
  if (!profile) return EMPTY_PROFILE;

  return {
    audience: "caregiver",
    // 돌봄이 화면의 현재 UI가 한국어이므로 답변 언어도 한국어로 맞춘다.
    language: "ko-KR",
    gender:
      profile.gender === "male" || profile.gender === "female"
        ? profile.gender
        : undefined,
    ageBand:
      profile.ageConfirmed && typeof profile.ageBand === "number"
        ? profile.ageBand
        : undefined,
    allergyIds: stringArray(profile.allergyIds),
    conditionIds: stringArray(profile.conditionIds),
    healthNotes: healthNotes(profile.healthNotes),
  };
}

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

function StopIcon() {
  return (
    <svg viewBox="0 0 28 28" aria-hidden="true">
      <rect x="9" y="9" width="10" height="10" rx="1.5" />
    </svg>
  );
}

export default function CaregiverApp() {
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<CaregiverTurn[]>([]);
  const [profile, setProfile] = useState<CaregiverProfile>(EMPTY_PROFILE);
  const [isLoading, setIsLoading] = useState(false);
  const [isToolMenuOpen, setIsToolMenuOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const composerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const chatScrollRef = useRef<HTMLElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const noticeTimerRef = useRef<number | null>(null);
  const hasConversation = turns.length > 0;

  useEffect(() => {
    let cancelled = false;
    void readStore<StoredState>("state-v1").then((stored) => {
      if (!cancelled) setProfile(profileFromStoredState(stored));
    });
    return () => {
      cancelled = true;
    };
  }, []);

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

  useEffect(() => {
    const scroller = chatScrollRef.current;
    if (!scroller || !hasConversation) return;
    scroller.scrollTo({
      top: scroller.scrollHeight,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
    });
  }, [hasConversation, turns]);

  useEffect(
    () => () => {
      abortRef.current?.abort();
      if (noticeTimerRef.current !== null) {
        window.clearTimeout(noticeTimerRef.current);
      }
    },
    [],
  );

  const completedHistory = useMemo(
    () =>
      turns
        .filter((turn) => turn.status === "complete" && turn.answer)
        .slice(-6)
        .map((turn) => ({ question: turn.question, answer: turn.answer })),
    [turns],
  );

  const showPreparationNotice = (message: string) => {
    setIsToolMenuOpen(false);
    setNotice(message);
    if (noticeTimerRef.current !== null) {
      window.clearTimeout(noticeTimerRef.current);
    }
    noticeTimerRef.current = window.setTimeout(() => setNotice(""), 3200);
  };

  const stopAnswer = () => {
    abortRef.current?.abort();
  };

  const startNewChat = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setTurns([]);
    setQuestion("");
    setNotice("");
    setIsLoading(false);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  };

  const submitQuestion = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const cleaned = question.trim().slice(0, 1000);
    if (!cleaned) {
      inputRef.current?.focus();
      return;
    }
    if (isLoading) return;

    const turnId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const nextTurn: CaregiverTurn = {
      id: turnId,
      question: cleaned,
      answer: "",
      riskLevel: "safe",
      warningMessage: "",
      status: "loading",
      errorMessage: "",
    };
    const controller = new AbortController();
    abortRef.current = controller;
    setTurns((current) => [...current, nextTurn]);
    setQuestion("");
    setNotice("");
    setIsToolMenuOpen(false);
    setIsLoading(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          message: cleaned,
          profile,
          history: completedHistory,
        }),
      });
      const payload = (await response.json()) as {
        answer?: string;
        riskLevel?: RiskLevel;
        warningMessage?: string;
        error?: string;
        retryAfterSeconds?: number;
      };

      if (!response.ok || !payload.answer) {
        const waitSeconds = Number(payload.retryAfterSeconds);
        const quotaMessage =
          response.status === 429 && Number.isFinite(waitSeconds)
            ? `요청이 많습니다. 약 ${Math.ceil(waitSeconds)}초 후 다시 질문해 주세요.`
            : "";
        throw new Error(
          quotaMessage || payload.error || "답변을 가져오지 못했습니다.",
        );
      }

      setTurns((current) =>
        current.map((turn) =>
          turn.id === turnId
            ? {
                ...turn,
                answer: payload.answer ?? "",
                riskLevel: payload.riskLevel ?? "safe",
                warningMessage: payload.warningMessage?.trim() ?? "",
                status: "complete",
              }
            : turn,
        ),
      );
    } catch (error) {
      const stopped = error instanceof DOMException && error.name === "AbortError";
      setTurns((current) =>
        current.map((turn) =>
          turn.id === turnId
            ? {
                ...turn,
                status: "error",
                errorMessage: stopped
                  ? "답변 생성을 중지했습니다."
                  : error instanceof Error
                    ? error.message
                    : "답변을 가져오지 못했습니다.",
              }
            : turn,
        ),
      );
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setIsLoading(false);
    }
  };

  const renderComposer = (placement: "hero" | "dock") => (
    <form
      className={`caregiver-composer caregiver-composer-${placement}`}
      onSubmit={submitQuestion}
    >
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
              onClick={() =>
                showPreparationNotice(
                  "사진 첨부 기능은 다음 단계에서 연결할 예정입니다.",
                )
              }
            >
              <span aria-hidden="true">▧</span>
              사진 첨부
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() =>
                showPreparationNotice(
                  "돌봄 기록 기능은 다음 단계에서 연결할 예정입니다.",
                )
              }
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
          placeholder={
            hasConversation
              ? "이어서 무엇이든 물어보세요"
              : "돌봄에 관해 무엇이든 물어보세요"
          }
          aria-label="돌봄 질문"
          autoComplete="off"
          disabled={isLoading}
        />

        <button
          type="button"
          className="caregiver-mic-button"
          aria-label="음성으로 질문하기"
          onClick={() =>
            showPreparationNotice(
              "음성 입력은 다음 단계에서 연결할 예정입니다.",
            )
          }
          disabled={isLoading}
        >
          <MicrophoneIcon />
        </button>
        <button
          type={isLoading ? "button" : "submit"}
          className={
            isLoading
              ? "caregiver-submit-button is-loading"
              : "caregiver-submit-button"
          }
          aria-label={isLoading ? "답변 생성 중지" : "질문 보내기"}
          disabled={!isLoading && !question.trim()}
          onClick={isLoading ? stopAnswer : undefined}
        >
          {isLoading ? <StopIcon /> : <WaveformIcon />}
        </button>
      </div>
    </form>
  );

  return (
    <main
      className={
        hasConversation ? "caregiver-root is-chatting" : "caregiver-root"
      }
    >
      <header className="caregiver-header">
        <Link
          className="caregiver-brand"
          href="/"
          aria-label="실버렌즈 시니어 화면으로 이동"
        >
          <span className="caregiver-brand-mark">SL</span>
          <span>SilverLens</span>
          <span className="caregiver-mode-badge">돌봄이</span>
        </Link>
        <div className="caregiver-header-actions">
          {hasConversation && (
            <button
              type="button"
              className="caregiver-new-chat"
              onClick={startNewChat}
            >
              새 대화
            </button>
          )}
          <Link className="caregiver-back-link" href="/">
            시니어 화면으로 돌아가기
            <span aria-hidden="true">↗</span>
          </Link>
        </div>
      </header>

      {!hasConversation ? (
        <>
          <section
            className="caregiver-hero"
            aria-labelledby="caregiver-heading"
          >
            <div className="caregiver-heading-group">
              <p>돌봄이 전용 도우미</p>
              <h1 id="caregiver-heading">오늘 어떤 돌봄이 필요하신가요?</h1>
              <span>
                식사, 복약, 건강 상태와 돌봄 기록을 편하게 물어보세요.
              </span>
            </div>
            {renderComposer("hero")}
            <p className="caregiver-notice" role="status" aria-live="polite">
              {notice}
            </p>
          </section>

          <footer className="caregiver-footer">
            <span>SilverLens Care</span>
            <span>
              돌봄 판단을 돕는 참고 도구이며, 의료진의 진단을 대신하지
              않습니다.
            </span>
          </footer>
        </>
      ) : (
        <>
          <section
            className="caregiver-chat"
            ref={chatScrollRef}
            aria-label="돌봄 대화"
            aria-live="polite"
            aria-busy={isLoading}
          >
            <div className="caregiver-thread">
              {turns.map((turn) => (
                <section className="caregiver-turn" key={turn.id}>
                  <p className="caregiver-user-message">{turn.question}</p>
                  <article className="caregiver-assistant-message">
                    <header>
                      <span className="caregiver-answer-mark" aria-hidden="true">
                        SL
                      </span>
                      <strong>돌봄 답변</strong>
                    </header>

                    {turn.warningMessage && (
                      <p
                        className={`caregiver-risk-note ${turn.riskLevel}`}
                        role={turn.riskLevel === "danger" ? "alert" : "status"}
                      >
                        {turn.warningMessage}
                      </p>
                    )}

                    {turn.status === "loading" && (
                      <div className="caregiver-answer-loading" role="status">
                        <span />
                        <span />
                        <span />
                        <p>등록된 건강정보와 안전 원칙을 확인하고 있어요.</p>
                      </div>
                    )}

                    {turn.status === "complete" && (
                      <div className="caregiver-answer-body">
                        <ReactMarkdown>{turn.answer}</ReactMarkdown>
                      </div>
                    )}

                    {turn.status === "error" && (
                      <div className="caregiver-answer-error" role="alert">
                        <strong>답변을 완료하지 못했습니다.</strong>
                        <p>{turn.errorMessage}</p>
                      </div>
                    )}
                  </article>
                </section>
              ))}
            </div>
          </section>

          <div className="caregiver-chat-dock">
            <p className="caregiver-chat-note" role="status" aria-live="polite">
              {notice ||
                "실버렌즈의 답변은 돌봄 참고용이며 의료진의 진단을 대신하지 않습니다."}
            </p>
            {renderComposer("dock")}
          </div>
        </>
      )}
    </main>
  );
}
