"use client";

import Image from "next/image";
import {
  KeyboardEvent,
  TouchEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

type Language = "ko-KR" | "en-US" | "ja-JP";
type Gender = "male" | "female";
type SetupStep = "language" | "gender" | "age" | "complete";
type RiskLevel = "danger" | "caution" | "good";

const languages: Array<{
  id: Language;
  flag: string;
  label: string;
  tts: string;
}> = [
  { id: "ko-KR", flag: "🇰🇷", label: "한국어", tts: "한국어" },
  { id: "en-US", flag: "🇺🇸", label: "English", tts: "English" },
  { id: "ja-JP", flag: "🇯🇵", label: "日本語", tts: "日本語" },
];

const ageBands = Array.from({ length: 12 }, (_, index) => (index + 1) * 10);

const cards: Array<{
  level: RiskLevel;
  status: string;
  ingredient: string;
  emoji: string;
  headline: string;
  body: string;
  detail: string;
}> = [
  {
    level: "danger",
    status: "위험해요",
    ingredient: "새우",
    emoji: "🦐",
    headline: "알레르기 정보와 맞지 않아요",
    body: "등록한 알레르기 정보에 새우가 포함되어 있어요.",
    detail: "먹지 말고 다른 식재료로 바꾸는 것이 안전해요.",
  },
  {
    level: "caution",
    status: "주의해요",
    ingredient: "부추",
    emoji: "🌿",
    headline: "이 식재료는 주의가 필요해요",
    body: "한 번에 너무 많이 먹으면 속이 불편할 수 있어요.",
    detail: "처음에는 소량만 드시고 몸 상태를 살펴보세요.",
  },
  {
    level: "good",
    status: "좋아요",
    ingredient: "사과",
    emoji: "🍎",
    headline: "적당량이면 좋은 선택이에요",
    body: "깨끗이 씻어 한 번에 적당량만 드세요.",
    detail: "개인의 건강 상태에 따라 섭취량은 달라질 수 있어요.",
  },
];

const promptCopy: Record<Language, Record<SetupStep, string>> = {
  "ko-KR": {
    language: "사용할 언어를 선택해 주세요.",
    gender: "성별을 선택해 주세요.",
    age: "나이대를 위아래로 움직여 선택해 주세요.",
    complete: "기본 설정이 끝났습니다. 알레르기와 질병 정보는 선택해서 추가할 수 있어요.",
  },
  "en-US": {
    language: "Please choose your language.",
    gender: "Please choose your gender.",
    age: "Scroll up or down to choose your age group.",
    complete: "Basic setup is complete. You may add allergy and health information.",
  },
  "ja-JP": {
    language: "使用する言語を選んでください。",
    gender: "性別を選んでください。",
    age: "上下に動かして年代を選んでください。",
    complete: "基本設定が完了しました。アレルギーと病気の情報を追加できます。",
  },
};

function getNextStep(
  language: Language | null,
  gender: Gender | null,
  ageConfirmed: boolean,
): SetupStep {
  if (!language) return "language";
  if (!gender) return "gender";
  if (!ageConfirmed) return "age";
  return "complete";
}

function Sidebar({ active }: { active: "setup" | "chat" }) {
  return (
    <aside className="sidebar" aria-label="서비스 메뉴">
      <div className="brand">
        <span className="brand-mark">SL</span>
        <span>실버렌즈</span>
      </div>
      <nav>
        <button className={active === "setup" ? "nav-item active" : "nav-item"}>
          <span aria-hidden="true">⌂</span>
          서비스 소개
        </button>
        <button className="nav-item">
          <span aria-hidden="true">●●</span>
          팀원 소개
        </button>
        <button className={active === "chat" ? "nav-item active" : "nav-item"}>
          <span aria-hidden="true">▤</span>
          대화 개요
        </button>
      </nav>
      <div className="sidebar-note">
        <strong>어르신을 위한 AI</strong>
        <span>말하고, 찍고, 편하게 물어보세요.</span>
      </div>
    </aside>
  );
}

export default function Home() {
  const [screen, setScreen] = useState<"setup" | "chat">("setup");
  const [language, setLanguage] = useState<Language | null>(null);
  const [gender, setGender] = useState<Gender | null>(null);
  const [ageBand, setAgeBand] = useState(70);
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [allergies, setAllergies] = useState<string[]>([]);
  const [conditions, setConditions] = useState<string[]>([]);
  const [showAllergyInput, setShowAllergyInput] = useState(false);
  const [showConditionInput, setShowConditionInput] = useState(false);
  const [cardIndex, setCardIndex] = useState(1);
  const [recordingContext, setRecordingContext] = useState<"setup" | "chat" | null>(null);
  const [recordedUrl, setRecordedUrl] = useState<string | null>(null);
  const [recordingError, setRecordingError] = useState("");
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const initialTtsPlayed = useRef(false);
  const touchStartX = useRef<number | null>(null);

  const nextStep = getNextStep(language, gender, ageConfirmed);
  const activeLanguage = language ?? "ko-KR";

  const speak = useCallback(
    (text: string, lang: Language = activeLanguage) => {
      if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = lang;
      utterance.rate = 0.82;
      utterance.pitch = 1.02;
      window.speechSynthesis.speak(utterance);
    },
    [activeLanguage],
  );

  useEffect(() => {
    if (initialTtsPlayed.current) return;
    initialTtsPlayed.current = true;
    const timer = window.setTimeout(() => speak(promptCopy["ko-KR"].language, "ko-KR"), 450);
    return () => window.clearTimeout(timer);
  }, [speak]);

  useEffect(() => {
    return () => {
      if (recordedUrl) URL.revokeObjectURL(recordedUrl);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, [recordedUrl]);

  const announceNext = useCallback(
    (
      nextLanguage: Language | null = language,
      nextGender: Gender | null = gender,
      nextAgeConfirmed: boolean = ageConfirmed,
    ) => {
      const step = getNextStep(nextLanguage, nextGender, nextAgeConfirmed);
      const lang = nextLanguage ?? "ko-KR";
      window.setTimeout(() => speak(promptCopy[lang][step], lang), 80);
    },
    [ageConfirmed, gender, language, speak],
  );

  const toggleLanguage = (id: Language) => {
    const next = language === id ? null : id;
    setLanguage(next);
    announceNext(next, gender, ageConfirmed);
  };

  const toggleGender = (id: Gender) => {
    const next = gender === id ? null : id;
    setGender(next);
    announceNext(language, next, ageConfirmed);
  };

  const moveAge = (direction: -1 | 1) => {
    const currentIndex = ageBands.indexOf(ageBand);
    const nextIndex = Math.min(ageBands.length - 1, Math.max(0, currentIndex + direction));
    const nextAge = ageBands[nextIndex];
    setAgeBand(nextAge);
    setAgeConfirmed(true);
    announceNext(language, gender, true);
  };

  const toggleAgeConfirmation = () => {
    const next = !ageConfirmed;
    setAgeConfirmed(next);
    announceNext(language, gender, next);
  };

  const addTag = (
    event: KeyboardEvent<HTMLInputElement>,
    setter: React.Dispatch<React.SetStateAction<string[]>>,
  ) => {
    if (event.key !== "Enter") return;
    const value = event.currentTarget.value.trim();
    if (!value) return;
    event.preventDefault();
    setter((items) => (items.includes(value) ? items : [...items, value]));
    event.currentTarget.value = "";
  };

  const stopRecording = () => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
  };

  const toggleRecording = async (context: "setup" | "chat") => {
    setRecordingError("");
    if (recordingContext) {
      stopRecording();
      return;
    }

    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      setRecordingError("이 브라우저에서는 음성 녹음을 사용할 수 없어요.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      });
      recorder.addEventListener("stop", () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        if (recordedUrl) URL.revokeObjectURL(recordedUrl);
        setRecordedUrl(URL.createObjectURL(blob));
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        mediaRecorderRef.current = null;
        setRecordingContext(null);
        speak("녹음이 저장되었습니다.", "ko-KR");
      });
      recorder.start();
      setRecordingContext(context);
    } catch {
      setRecordingError("마이크 권한을 허용하면 음성으로 말할 수 있어요.");
    }
  };

  const card = cards[cardIndex];

  const cardTts = useMemo(
    () => `${card.status}. ${card.ingredient}. ${card.headline}. ${card.body} ${card.detail}`,
    [card],
  );

  const moveCard = useCallback(
    (direction: -1 | 1) => {
      const next = (cardIndex + direction + cards.length) % cards.length;
      setCardIndex(next);
      const nextCard = cards[next];
      speak(
        `${nextCard.status}. ${nextCard.ingredient}. ${nextCard.headline}. ${nextCard.body} ${nextCard.detail}`,
        "ko-KR",
      );
    },
    [cardIndex, speak],
  );

  const handleTouchStart = (event: TouchEvent) => {
    touchStartX.current = event.touches[0]?.clientX ?? null;
  };

  const handleTouchEnd = (event: TouchEvent) => {
    if (touchStartX.current === null) return;
    const endX = event.changedTouches[0]?.clientX ?? touchStartX.current;
    const distance = endX - touchStartX.current;
    touchStartX.current = null;
    if (Math.abs(distance) < 45) return;
    moveCard(distance < 0 ? 1 : -1);
  };

  const beginChat = () => {
    if (nextStep !== "complete") {
      announceNext();
      return;
    }
    setScreen("chat");
    window.setTimeout(() => speak(cardTts, "ko-KR"), 180);
  };

  if (screen === "chat") {
    const isRecording = recordingContext === "chat";
    return (
      <main className="app-shell">
        <Sidebar active="chat" />
        <section className="chat-screen">
          <header className="chat-header">
            <button className="back-button" onClick={() => setScreen("setup")}>
              ← 설정으로
            </button>
            <div className="profile-pills">
              <span>🌐 {languages.find((item) => item.id === activeLanguage)?.label}</span>
              <span>● {ageBand}대 맞춤</span>
            </div>
          </header>

          <h1>오늘은 무엇을 도와드릴까요?</h1>

          <div className="conversation-stage">
            <div className="grandson-panel">
              <Image
                src="/grandson.png"
                alt="다정하게 이야기를 듣는 어린 손자 캐릭터"
                width={1024}
                height={1536}
                priority
              />
              <div className="speech-bubble">할머니, 할아버지 말씀을 잘 듣고 있어요.</div>
            </div>

            <div
              className={`risk-carousel ${card.level}`}
              onTouchStart={handleTouchStart}
              onTouchEnd={handleTouchEnd}
            >
              <button className="carousel-arrow left" onClick={() => moveCard(-1)} aria-label="이전 정보">
                ‹
              </button>
              <article className="risk-card" aria-live="polite">
                <div className={`status-chip ${card.level}`}>{card.status}</div>
                <div className="ingredient-row">
                  <span className="ingredient-emoji" aria-hidden="true">{card.emoji}</span>
                  <div>
                    <span className="eyebrow">식재료</span>
                    <strong>{card.ingredient}</strong>
                  </div>
                </div>
                <h2>{card.headline}</h2>
                <p>{card.body}</p>
                <p className="detail">{card.detail}</p>
              </article>
              <button className="carousel-arrow right" onClick={() => moveCard(1)} aria-label="다음 정보">
                ›
              </button>
              <div className="carousel-footer">
                <div className="dots" aria-label={`${cardIndex + 1}번째 정보`}>
                  {cards.map((item, index) => (
                    <button
                      key={item.status}
                      className={index === cardIndex ? "dot active" : "dot"}
                      onClick={() => {
                        setCardIndex(index);
                        const selected = cards[index];
                        speak(`${selected.status}. ${selected.ingredient}. ${selected.headline}. ${selected.body}`, "ko-KR");
                      }}
                      aria-label={`${index + 1}번째 카드`}
                    />
                  ))}
                </div>
                <span>옆으로 밀어 다음 정보 보기</span>
              </div>
            </div>
          </div>

          <div className="answer-audio">
            <button onClick={() => speak(cardTts, "ko-KR")}>🔊 답변 다시 듣기</button>
            <span>이전 카드로 돌아가면 해당 안내를 다시 들려드려요.</span>
          </div>

          <div className="chat-actions">
            <button
              className={isRecording ? "action-button recording" : "action-button voice"}
              onClick={() => toggleRecording("chat")}
            >
              <span>{isRecording ? "●" : "🎙️"}</span>
              <strong>{isRecording ? "녹음 중" : "음성으로 말하기"}</strong>
              <small>{isRecording ? "다시 누르면 저장" : "누르면 녹음 시작"}</small>
            </button>
            <button className="action-button camera">
              <span>📷</span>
              <strong>사진 찍기</strong>
              <small>식재료를 보여주세요</small>
            </button>
            <button className="action-button keyboard">
              <span>⌨️</span>
              <strong>글자로 입력</strong>
              <small>큰 글씨 입력창 열기</small>
            </button>
          </div>

          {recordedUrl && (
            <div className="saved-recording">
              <span>✓ 음성이 저장되었습니다.</span>
              <audio controls src={recordedUrl}>
                <track kind="captions" />
              </audio>
            </div>
          )}
          {recordingError && <p className="error-message" role="alert">{recordingError}</p>}
          <p className="medical-note">🛡 건강 정보는 참고용이며, 증상이 있으면 의료진과 상담하세요.</p>
        </section>
      </main>
    );
  }

  const setupRecording = recordingContext === "setup";
  const canStart = nextStep === "complete";
  const ageIndex = ageBands.indexOf(ageBand);
  const previousAge = ageBands[Math.max(0, ageIndex - 1)];
  const nextAge = ageBands[Math.min(ageBands.length - 1, ageIndex + 1)];

  return (
    <main className="app-shell">
      <Sidebar active="setup" />
      <section className="setup-screen">
        <div className="setup-progress" aria-label="설정 진행 상황">
          <span className={language ? "done" : "current"}>언어 {language ? "✓" : ""}</span>
          <span className={gender ? "done" : nextStep === "gender" ? "current" : ""}>성별 {gender ? "✓" : ""}</span>
          <span className={ageConfirmed ? "done" : nextStep === "age" ? "current" : ""}>
            {ageConfirmed ? "나이 ✓" : `다음: ${nextStep === "language" ? "언어" : nextStep === "gender" ? "성별" : "나이"}`}
          </span>
        </div>

        <div className="auto-tts">🔊 <strong>자동 음성 안내 켜짐</strong></div>

        <fieldset className="form-section">
          <legend>언어</legend>
          <div className="language-grid">
            {languages.map((item) => (
              <button
                key={item.id}
                className={language === item.id ? "language-button selected" : "language-button"}
                onClick={() => toggleLanguage(item.id)}
                aria-pressed={language === item.id}
              >
                <span className="flag" aria-hidden="true">{item.flag}</span>
                <span>{item.label}</span>
                {language === item.id && <span className="selection-check">✓</span>}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="form-section">
          <legend>성별</legend>
          <div className="gender-grid">
            <button
              className={gender === "male" ? "gender-button male selected" : "gender-button male"}
              onClick={() => toggleGender("male")}
              aria-pressed={gender === "male"}
            >
              <span aria-hidden="true">♟</span>
              <strong>남자</strong>
              {gender === "male" && <span className="selection-check">✓</span>}
            </button>
            <button
              className={gender === "female" ? "gender-button female selected" : "gender-button female"}
              onClick={() => toggleGender("female")}
              aria-pressed={gender === "female"}
            >
              <span aria-hidden="true">♟</span>
              <strong>여자</strong>
              {gender === "female" && <span className="selection-check">✓</span>}
            </button>
          </div>
        </fieldset>

        <fieldset className="form-section age-section">
          <legend>나이</legend>
          <div
            className={ageConfirmed ? "age-picker confirmed" : "age-picker"}
            onWheel={(event) => {
              event.preventDefault();
              moveAge(event.deltaY > 0 ? 1 : -1);
            }}
          >
            <div className="age-controls">
              <button onClick={() => moveAge(-1)} disabled={ageIndex === 0} aria-label="이전 나이대">⌃</button>
              <button className="age-wheel" onClick={toggleAgeConfirmation} aria-pressed={ageConfirmed}>
                <span>{previousAge}대</span>
                <strong>{ageBand}대</strong>
                <span>{nextAge}대</span>
              </button>
              <button onClick={() => moveAge(1)} disabled={ageIndex === ageBands.length - 1} aria-label="다음 나이대">⌄</button>
            </div>
            <div className="age-help">
              <strong>10대 ~ 120대</strong>
              <span>누른 채 위아래로 움직이거나 스크롤하세요</span>
              <em>{ageConfirmed ? "✓ 선택됨 · 다시 누르면 해제" : "가운데 나이대를 눌러 선택"}</em>
            </div>
          </div>
        </fieldset>

        <div className="health-grid">
          <section className="health-card">
            <div className="health-title">
              <h2>알레르기 정보</h2>
              <span className="info-tip" title="먹으면 불편한 음식">i</span>
            </div>
            <p>먹으면 불편한 음식</p>
            <button onClick={() => setShowAllergyInput((value) => !value)}>＋ 음식 추가하기</button>
            {showAllergyInput && (
              <input
                autoFocus
                placeholder="입력 후 엔터"
                onKeyDown={(event) => addTag(event, setAllergies)}
                aria-label="알레르기 음식 입력"
              />
            )}
            <div className="tag-list">
              {allergies.map((item) => (
                <button key={item} onClick={() => setAllergies((items) => items.filter((value) => value !== item))}>
                  {item} ×
                </button>
              ))}
            </div>
          </section>

          <section className="health-card">
            <div className="health-title">
              <h2>질병 정보</h2>
              <span className="info-tip" title="현재 치료 중인 질환">i</span>
            </div>
            <p>현재 치료 중인 질환</p>
            <button onClick={() => setShowConditionInput((value) => !value)}>＋ 질환 추가하기</button>
            {showConditionInput && (
              <input
                autoFocus
                placeholder="입력 후 엔터"
                onKeyDown={(event) => addTag(event, setConditions)}
                aria-label="질병 정보 입력"
              />
            )}
            <div className="tag-list">
              {conditions.map((item) => (
                <button key={item} onClick={() => setConditions((items) => items.filter((value) => value !== item))}>
                  {item} ×
                </button>
              ))}
            </div>
          </section>
        </div>

        <div className="voice-row">
          <button
            className={setupRecording ? "voice-control recording" : "voice-control"}
            onClick={() => toggleRecording("setup")}
          >
            <span>{setupRecording ? "●" : "🎙️"}</span>
            <div>
              <strong>{setupRecording ? "녹음 중" : "음성으로 말하기"}</strong>
              <small>{setupRecording ? "다시 누르면 저장" : "누르면 녹음 시작"}</small>
            </div>
          </button>
          <button className="replay-control" onClick={() => announceNext()}>
            <span>🔊</span>
            <div>
              <strong>안내 다시 듣기</strong>
              <small>현재 단계부터 안내</small>
            </div>
          </button>
        </div>

        {recordedUrl && (
          <div className="saved-recording compact">
            <span>✓ 음성이 저장되었습니다.</span>
            <audio controls src={recordedUrl}>
              <track kind="captions" />
            </audio>
          </div>
        )}
        {recordingError && <p className="error-message" role="alert">{recordingError}</p>}

        <button
          className={canStart ? "start-button" : "start-button disabled"}
          onClick={beginChat}
          aria-disabled={!canStart}
        >
          <span>설정 완료하고 대화 시작</span>
          <span aria-hidden="true">›</span>
        </button>
        {!canStart && (
          <p className="completion-hint">언어·성별·나이대를 선택하면 대화를 시작할 수 있어요.</p>
        )}
      </section>
    </main>
  );
}
