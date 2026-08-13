"use client";

import Link from "next/link";
import {
  type FormEvent,
  type KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import ReactMarkdown from "react-markdown";
import type { CaregiverSessionUser } from "../backend/services/caregiverAuth";
import { getHealthLabel } from "../backend/data/healthTerms";

type RiskLevel = "danger" | "caution" | "safe";

type SeniorProfile = {
  language: "ko-KR" | "en-US" | "ja-JP" | null;
  gender: "male" | "female" | null;
  ageBand: number;
  ageConfirmed: boolean;
  allergyIds: string[];
  conditionIds: string[];
  healthNotes: Array<{
    id?: string;
    kind: "allergy" | "condition" | "setup";
    text: string;
    savedAt?: number;
  }>;
};

type CaregiverSenior = {
  id: string;
  alias: string;
  linkedAt: number;
  updatedAt: number;
  profile: SeniorProfile;
  recentChatCount: number;
};

type SeniorChat = {
  id: string;
  question: string;
  answer: string;
  riskLevel: RiskLevel;
  warningMessage: string;
};

type SeniorDetail = CaregiverSenior & { chatTurns: SeniorChat[] };

type ThreadSummary = {
  id: string;
  title: string;
  seniorId: string | null;
  seniorAlias: string | null;
  updatedAt: number;
};

type CareMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  riskLevel: RiskLevel;
  warningMessage: string;
  createdAt: number;
  status?: "loading" | "error";
};

type CaregiverAppProps = {
  caregiver?: CaregiverSessionUser;
  onLogout?: () => void | Promise<void>;
};

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m5 12 14-7-4 14-3-6-7-1Z" />
      <path d="m12 13 7-8" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="7" y="7" width="10" height="10" rx="1.5" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5" />
    </svg>
  );
}

async function responseJson<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error || "요청을 처리하지 못했습니다.");
  return payload;
}

function relativeTime(value: number) {
  const elapsed = Date.now() - value;
  if (elapsed < 60_000) return "방금 전";
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}분 전`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}시간 전`;
  return new Date(value).toLocaleDateString("ko-KR", { month: "short", day: "numeric" });
}

export default function CaregiverApp({ caregiver, onLogout }: CaregiverAppProps) {
  const [seniors, setSeniors] = useState<CaregiverSenior[]>([]);
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [selectedSeniorId, setSelectedSeniorId] = useState<string | null>(null);
  const [seniorDetail, setSeniorDetail] = useState<SeniorDetail | null>(null);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<CareMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [linkCode, setLinkCode] = useState("");
  const [linkAlias, setLinkAlias] = useState("");
  const [seniorSearch, setSeniorSearch] = useState("");
  const [isLoadingOverview, setIsLoadingOverview] = useState(true);
  const [isLoadingThread, setIsLoadingThread] = useState(false);
  const [isAnswering, setIsAnswering] = useState(false);
  const [isLinking, setIsLinking] = useState(false);
  const [deletingThreadId, setDeletingThreadId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [linkError, setLinkError] = useState("");
  const [mobilePanel, setMobilePanel] = useState<"chat" | "seniors" | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const selectedSenior = useMemo(
    () => seniors.find((senior) => senior.id === selectedSeniorId) ?? null,
    [selectedSeniorId, seniors],
  );
  const visibleSeniors = useMemo(() => {
    const query = seniorSearch.trim().toLocaleLowerCase("ko-KR");
    return query
      ? seniors.filter((senior) => senior.alias.toLocaleLowerCase("ko-KR").includes(query))
      : seniors;
  }, [seniorSearch, seniors]);

  const loadOverview = async (preferredSeniorId?: string | null) => {
    const result = await fetch("/api/caregiver/overview", { cache: "no-store" }).then(
      (response) => responseJson<{ seniors: CaregiverSenior[]; threads: ThreadSummary[] }>(response),
    );
    setSeniors(result.seniors);
    setThreads(result.threads);
    setSelectedSeniorId((current) => {
      const preferred = preferredSeniorId === undefined ? current : preferredSeniorId;
      if (preferred && result.seniors.some((senior) => senior.id === preferred)) return preferred;
      return result.seniors[0]?.id ?? null;
    });
  };

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/caregiver/overview", { cache: "no-store" })
      .then((response) => responseJson<{ seniors: CaregiverSenior[]; threads: ThreadSummary[] }>(response))
      .then((result) => {
        if (cancelled) return;
        setSeniors(result.seniors);
        setThreads(result.threads);
        setSelectedSeniorId(result.seniors[0]?.id ?? null);
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "정보를 불러오지 못했습니다.");
      })
      .finally(() => {
        if (!cancelled) setIsLoadingOverview(false);
      });
    return () => {
      cancelled = true;
      abortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!selectedSeniorId) {
      setSeniorDetail(null);
      return;
    }
    let cancelled = false;
    let refreshing = false;
    const refresh = async () => {
      if (refreshing || document.visibilityState === "hidden") return;
      refreshing = true;
      try {
        const [overview, detail] = await Promise.all([
          fetch("/api/caregiver/overview", { cache: "no-store" }).then((response) =>
            responseJson<{ seniors: CaregiverSenior[]; threads: ThreadSummary[] }>(response),
          ),
          fetch(`/api/caregiver/seniors/${encodeURIComponent(selectedSeniorId)}`, {
            cache: "no-store",
          }).then((response) => responseJson<SeniorDetail>(response)),
        ]);
        if (cancelled) return;
        setSeniors(overview.seniors);
        setThreads(overview.threads);
        setSeniorDetail(detail);
      } catch {
        // 일시적인 새로고침 실패는 기존 정보를 유지하고 다음 주기에 다시 시도한다.
      } finally {
        refreshing = false;
      }
    };
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 4_000);
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [selectedSeniorId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    });
  }, [messages]);

  const newChat = (seniorId: string | null = selectedSeniorId) => {
    abortRef.current?.abort();
    setActiveThreadId(null);
    setMessages([]);
    setQuestion("");
    setError("");
    setSelectedSeniorId(seniorId);
    setMobilePanel(null);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  };

  const chooseSenior = (seniorId: string) => {
    newChat(seniorId);
  };

  const openThread = async (thread: ThreadSummary) => {
    if (isLoadingThread) return;
    setIsLoadingThread(true);
    setError("");
    setActiveThreadId(thread.id);
    setSelectedSeniorId(thread.seniorId);
    setMobilePanel(null);
    try {
      const result = await fetch(`/api/caregiver/threads/${encodeURIComponent(thread.id)}`, {
        cache: "no-store",
      }).then((response) =>
        responseJson<{ thread: ThreadSummary; messages: CareMessage[] }>(response),
      );
      setMessages(result.messages);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "대화를 불러오지 못했습니다.");
    } finally {
      setIsLoadingThread(false);
    }
  };

  const deleteThread = async (thread: ThreadSummary) => {
    if (deletingThreadId || (isAnswering && activeThreadId === thread.id)) return;
    if (!window.confirm(`“${thread.title}” 대화 기록을 삭제할까요?\n삭제한 기록은 복구할 수 없습니다.`)) {
      return;
    }
    setDeletingThreadId(thread.id);
    setError("");
    try {
      await fetch(`/api/caregiver/threads/${encodeURIComponent(thread.id)}`, {
        method: "DELETE",
      }).then((response) => responseJson<{ ok: true }>(response));
      setThreads((current) => current.filter((item) => item.id !== thread.id));
      if (activeThreadId === thread.id) newChat(thread.seniorId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "대화 기록을 삭제하지 못했습니다.");
    } finally {
      setDeletingThreadId(null);
    }
  };

  const registerSenior = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!linkCode.trim() || isLinking) return;
    setIsLinking(true);
    setLinkError("");
    try {
      const result = await fetch("/api/caregiver/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: linkCode, alias: linkAlias }),
      }).then((response) => responseJson<{ senior: CaregiverSenior }>(response));
      setLinkCode("");
      setLinkAlias("");
      await loadOverview(result.senior.id);
      newChat(result.senior.id);
    } catch (caught) {
      setLinkError(caught instanceof Error ? caught.message : "연결하지 못했습니다.");
    } finally {
      setIsLinking(false);
    }
  };

  const unlinkSenior = async (senior: CaregiverSenior) => {
    if (!window.confirm(`${senior.alias} 연결을 이 계정에서 해제할까요?`)) return;
    try {
      await fetch(`/api/caregiver/seniors/${encodeURIComponent(senior.id)}`, {
        method: "DELETE",
      }).then((response) => responseJson<{ ok: true }>(response));
      const remaining = seniors.filter((item) => item.id !== senior.id);
      setSeniors(remaining);
      if (selectedSeniorId === senior.id) newChat(remaining[0]?.id ?? null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "연결을 해제하지 못했습니다.");
    }
  };

  const submitQuestion = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    const cleaned = question.trim().slice(0, 1600);
    if (!cleaned || isAnswering) return;
    const controller = new AbortController();
    abortRef.current = controller;
    const sentAt = Date.now();
    const userMessage: CareMessage = {
      id: `user-${sentAt}`,
      role: "user",
      content: cleaned,
      riskLevel: "safe",
      warningMessage: "",
      createdAt: sentAt,
    };
    const loadingMessage: CareMessage = {
      id: `answer-${sentAt}`,
      role: "assistant",
      content: "",
      riskLevel: "safe",
      warningMessage: "",
      createdAt: sentAt + 1,
      status: "loading",
    };
    setMessages((current) => [...current, userMessage, loadingMessage]);
    setQuestion("");
    setError("");
    setIsAnswering(true);
    try {
      const result = await fetch("/api/caregiver/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          message: cleaned,
          threadId: activeThreadId,
          seniorId: selectedSeniorId,
        }),
      }).then((response) =>
        responseJson<{
          threadId: string;
          answer: string;
          riskLevel: RiskLevel;
          warningMessage: string;
        }>(response),
      );
      setActiveThreadId(result.threadId);
      setMessages((current) =>
        current.map((message) =>
          message.id === loadingMessage.id
            ? {
                ...message,
                content: result.answer,
                riskLevel: result.riskLevel,
                warningMessage: result.warningMessage,
                status: undefined,
              }
            : message,
        ),
      );
      await loadOverview(selectedSeniorId);
    } catch (caught) {
      const stopped = caught instanceof DOMException && caught.name === "AbortError";
      setMessages((current) =>
        current.map((message) =>
          message.id === loadingMessage.id
            ? {
                ...message,
                content: stopped ? "답변 생성을 중지했습니다." : caught instanceof Error ? caught.message : "답변을 만들지 못했습니다.",
                status: "error",
              }
            : message,
        ),
      );
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setIsAnswering(false);
    }
  };

  const handleComposerKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submitQuestion();
    }
  };

  const profile = seniorDetail?.profile ?? selectedSenior?.profile;

  return (
    <main className="care-workspace">
      <header className="care-topbar">
        <Link className="care-logo" href="/">
          <span>SL</span>
          <strong>SilverLens Care</strong>
        </Link>
        <nav className="care-mobile-tabs" aria-label="모바일 패널">
          <button type="button" onClick={() => setMobilePanel("chat")}>대화 기록</button>
          <button type="button" onClick={() => setMobilePanel("seniors")}>시니어</button>
        </nav>
        <div className="care-account">
          <span title={caregiver?.email}>{caregiver?.name}</span>
          <button type="button" onClick={() => void onLogout?.()}>로그아웃</button>
          <Link href="/">시니어 화면</Link>
        </div>
      </header>

      <div className="care-layout">
        <aside className={`care-history-panel ${mobilePanel === "chat" ? "is-mobile-open" : ""}`}>
          <div className="care-panel-title">
            <div>
              <span>WORKSPACE</span>
              <h2>대화 기록</h2>
            </div>
            <button type="button" className="care-close-mobile" onClick={() => setMobilePanel(null)}>×</button>
          </div>
          <button type="button" className="care-new-thread" onClick={() => newChat()}>
            <PlusIcon /> 새 대화
          </button>
          <div className="care-thread-list">
            {threads.length === 0 && !isLoadingOverview ? (
              <p className="care-empty-list">아직 저장된 대화가 없습니다.</p>
            ) : (
              threads.map((thread) => (
                <div
                  key={thread.id}
                  className={`care-thread-item ${activeThreadId === thread.id ? "active" : ""}`}
                >
                  <button
                    type="button"
                    className="care-thread-open"
                    onClick={() => void openThread(thread)}
                  >
                    <strong>{thread.title}</strong>
                    <span>{thread.seniorAlias || "일반 돌봄 질문"} · {relativeTime(thread.updatedAt)}</span>
                  </button>
                  <button
                    type="button"
                    className="care-thread-delete"
                    onClick={() => void deleteThread(thread)}
                    disabled={
                      deletingThreadId === thread.id ||
                      (isAnswering && activeThreadId === thread.id)
                    }
                    aria-label={`${thread.title} 대화 기록 삭제`}
                    title={
                      isAnswering && activeThreadId === thread.id
                        ? "답변이 끝난 후 삭제할 수 있습니다."
                        : "대화 기록 삭제"
                    }
                  >
                    <TrashIcon />
                  </button>
                </div>
              ))
            )}
          </div>
          <p className="care-history-foot">대화는 로그인한 돌봄이 계정에 안전하게 저장됩니다.</p>
        </aside>

        <section className="care-main-chat">
          <header className="care-chat-context">
            <div>
              <span>{selectedSenior ? "선택한 시니어" : "일반 돌봄 도우미"}</span>
              <h1>{selectedSenior?.alias ?? "무엇을 도와드릴까요?"}</h1>
            </div>
            <button type="button" onClick={() => newChat()}>새 대화</button>
          </header>

          <div className="care-message-scroll" ref={scrollRef} aria-live="polite">
            {isLoadingOverview ? (
              <div className="care-chat-empty"><p>돌봄 정보를 불러오는 중입니다…</p></div>
            ) : messages.length === 0 ? (
              <div className="care-chat-empty">
                <span className="care-ai-mark">SL</span>
                <h2>{selectedSenior ? `${selectedSenior.alias}에 대해 무엇이 궁금하신가요?` : "지금 무엇을 도와드릴까요?"}</h2>
                <p>
                  {selectedSenior
                    ? "연결된 건강정보를 참고해 식사, 복약, 생활 관리 질문을 함께 살펴봅니다."
                    : "시니어를 선택하면 등록된 건강정보를 참고합니다. 일반적인 돌봄 질문도 가능합니다."}
                </p>
                <div className="care-suggestions">
                  {[
                    "오늘 식사에서 주의할 점을 정리해줘",
                    "최근 대화에서 반복된 걱정이 있는지 알려줘",
                    "병원 방문 전에 확인할 질문 목록을 만들어줘",
                  ].map((suggestion) => (
                    <button key={suggestion} type="button" onClick={() => { setQuestion(suggestion); inputRef.current?.focus(); }}>
                      {suggestion}<span>↗</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="care-messages">
                {messages.map((message) =>
                  message.role === "user" ? (
                    <p key={message.id} className="care-user-bubble">{message.content}</p>
                  ) : (
                    <article key={message.id} className={`care-ai-answer ${message.status === "error" ? "is-error" : ""}`}>
                      <header><span>SL</span><strong>SilverLens AI</strong></header>
                      {message.warningMessage && (
                        <p className={`care-risk ${message.riskLevel}`}>{message.warningMessage}</p>
                      )}
                      {message.status === "loading" ? (
                        <div className="care-thinking"><i /><i /><i /><span>연결된 정보와 안전 기준을 확인하고 있어요.</span></div>
                      ) : (
                        <div className="care-answer-markdown"><ReactMarkdown>{message.content}</ReactMarkdown></div>
                      )}
                    </article>
                  ),
                )}
              </div>
            )}
          </div>

          {error && <p className="care-global-error" role="alert">{error}</p>}
          <form className="care-chat-composer" onSubmit={(event) => void submitQuestion(event)}>
            <textarea
              ref={inputRef}
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              onKeyDown={handleComposerKey}
              placeholder={selectedSenior ? `${selectedSenior.alias}의 돌봄에 관해 물어보세요` : "무엇이든 물어보세요"}
              rows={1}
              maxLength={1600}
              disabled={isAnswering}
            />
            <button
              type={isAnswering ? "button" : "submit"}
              aria-label={isAnswering ? "답변 중지" : "질문 보내기"}
              onClick={isAnswering ? () => abortRef.current?.abort() : undefined}
              disabled={!isAnswering && !question.trim()}
            >
              {isAnswering ? <StopIcon /> : <SendIcon />}
            </button>
            <small>AI 답변은 참고용이며 진단이나 처방을 대신하지 않습니다.</small>
          </form>
        </section>

        <aside className={`care-senior-panel ${mobilePanel === "seniors" ? "is-mobile-open" : ""}`}>
          <div className="care-panel-title">
            <div>
              <span>CARE LIST</span>
              <h2>시니어 관리</h2>
            </div>
            <button type="button" className="care-close-mobile" onClick={() => setMobilePanel(null)}>×</button>
          </div>

          <form className="care-link-form" onSubmit={registerSenior}>
            <strong>새 시니어 연결</strong>
            <p>시니어의 데이터 화면에서 받은 한글 연결 코드를 입력하세요.</p>
            <input
              value={linkAlias}
              onChange={(event) => setLinkAlias(event.target.value.slice(0, 30))}
              placeholder="표시 이름 (선택)"
              aria-label="시니어 표시 이름"
            />
            <div>
              <input
                value={linkCode}
                onChange={(event) => setLinkCode(event.target.value.slice(0, 30))}
                placeholder="하늘-나무-기차-572"
                aria-label="연결 코드"
                autoCapitalize="none"
                autoComplete="off"
              />
              <button type="submit" disabled={isLinking || !linkCode.trim()}>{isLinking ? "연결 중" : "연결"}</button>
            </div>
            {linkError && <small role="alert">{linkError}</small>}
          </form>

          <label className="care-senior-search">
            <span aria-hidden="true">⌕</span>
            <input value={seniorSearch} onChange={(event) => setSeniorSearch(event.target.value)} placeholder="시니어 검색" />
          </label>

          <div className="care-senior-list">
            {visibleSeniors.length === 0 ? (
              <p className="care-empty-list">연결된 시니어가 없습니다.<br />연결 코드를 받아 등록해 주세요.</p>
            ) : (
              visibleSeniors.map((senior) => (
                <div key={senior.id} className={selectedSeniorId === senior.id ? "active" : ""}>
                  <button type="button" onClick={() => chooseSenior(senior.id)}>
                    <span className="care-avatar">{senior.alias.slice(0, 1)}</span>
                    <span><strong>{senior.alias}</strong><small>대화 {senior.recentChatCount}개 · {relativeTime(senior.updatedAt)} 동기화</small></span>
                  </button>
                  <button type="button" className="care-unlink" onClick={() => void unlinkSenior(senior)} aria-label={`${senior.alias} 연결 해제`}>×</button>
                </div>
              ))
            )}
          </div>

          {selectedSenior && profile && (
            <section className="care-profile-card">
              <header><span>건강정보</span><strong>{selectedSenior.alias}</strong></header>
              <dl>
                <div><dt>기본</dt><dd>{profile.ageConfirmed ? `${profile.ageBand}대` : "나이 미입력"}{profile.gender ? ` · ${profile.gender === "male" ? "남성" : "여성"}` : ""}</dd></div>
                <div><dt>알레르기</dt><dd>{profile.allergyIds.length ? profile.allergyIds.map((id) => getHealthLabel(id, "ko-KR")).join(", ") : "등록 없음"}</dd></div>
                <div><dt>질병·건강</dt><dd>{profile.conditionIds.length ? profile.conditionIds.map((id) => getHealthLabel(id, "ko-KR")).join(", ") : "등록 없음"}</dd></div>
              </dl>
              {profile.healthNotes.length > 0 && (
                <div className="care-profile-notes">
                  <strong>상세 메모</strong>
                  {profile.healthNotes.map((note, index) => <p key={note.id || index}>{note.text}</p>)}
                </div>
              )}
              {seniorDetail?.chatTurns.length ? (
                <details className="care-senior-recent">
                  <summary>시니어의 최근 질문 {seniorDetail.chatTurns.length}개</summary>
                  {seniorDetail.chatTurns.slice(0, 8).map((turn) => (
                    <div key={turn.id}><strong>{turn.question || "음성·사진 질문"}</strong><p>{turn.answer}</p></div>
                  ))}
                </details>
              ) : null}
            </section>
          )}
        </aside>
      </div>

      {mobilePanel && <button className="care-mobile-shade" type="button" aria-label="패널 닫기" onClick={() => setMobilePanel(null)} />}
    </main>
  );
}
