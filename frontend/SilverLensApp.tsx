"use client";

import {
  KeyboardEvent,
  TouchEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import ReactMarkdown from "react-markdown";

type Language = "ko-KR" | "en-US" | "ja-JP";
type Gender = "male" | "female";
type SetupStep = "language" | "gender" | "age" | "complete";
type PageScreen = "setup" | "chat" | "service" | "team";
type RiskLevel = "danger" | "caution" | "good";
type FoodCard = {
  level: RiskLevel;
  status: string;
  ingredient: string;
  emoji: string;
  headline: string;
  body: string;
  detail: string;
};

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

const generalFoodCards: FoodCard[] = [
  {
    level: "good",
    status: "추천해요",
    ingredient: "여러 색의 채소",
    emoji: "🥦",
    headline: "채소를 식사에 넉넉히 더해 보세요",
    body: "브로콜리, 배추, 당근처럼 여러 색의 채소를 골고루 드세요.",
    detail: "기름과 소금은 적게 쓰고, 씹기 편하게 익혀 드세요.",
  },
  {
    level: "good",
    status: "추천해요",
    ingredient: "통곡물",
    emoji: "🌾",
    headline: "정제된 곡물 대신 통곡물을 골라 보세요",
    body: "현미, 보리, 귀리 같은 통곡물을 식사에 조금씩 활용해 보세요.",
    detail: "평소 소화 상태와 씹는 힘에 맞게 충분히 부드럽게 조리하세요.",
  },
  {
    level: "good",
    status: "추천해요",
    ingredient: "단백질 식품",
    emoji: "🍽️",
    headline: "매 끼니 단백질 식품을 챙겨 보세요",
    body: "콩, 두부, 달걀, 생선, 살코기 중 먹을 수 있는 식품을 고르세요.",
    detail: "등록한 알레르기가 있는 식품은 반드시 제외해야 해요.",
  },
];

const hypertensionCards: FoodCard[] = [
  {
    level: "good",
    status: "추천해요",
    ingredient: "싱겁게 조리한 채소",
    emoji: "🥬",
    headline: "채소는 싱겁게 조리해 드세요",
    body: "국물, 소금, 간장 사용을 줄이고 채소를 다양하게 드세요.",
    detail: "절임·가공식품보다 신선하거나 냉동한 채소가 나트륨을 줄이기 쉬워요.",
  },
  {
    level: "good",
    status: "추천해요",
    ingredient: "통곡물",
    emoji: "🌾",
    headline: "흰 곡물 대신 통곡물을 활용해 보세요",
    body: "현미, 보리, 귀리처럼 덜 정제된 곡물을 부드럽게 조리해 보세요.",
    detail: "양은 평소 식사량과 의료진의 안내에 맞추세요.",
  },
];

const diabetesCards: FoodCard[] = [
  {
    level: "good",
    status: "추천해요",
    ingredient: "전분이 적은 채소",
    emoji: "🥗",
    headline: "접시의 절반은 채소로 채워 보세요",
    body: "브로콜리, 시금치, 배추 같은 전분이 적은 채소를 활용해 보세요.",
    detail: "단맛이 강한 소스와 설탕은 적게 쓰는 편이 좋아요.",
  },
  {
    level: "good",
    status: "추천해요",
    ingredient: "통곡물과 단백질",
    emoji: "🍚",
    headline: "곡물과 단백질은 나누어 담아 보세요",
    body: "통곡물과 먹을 수 있는 단백질 식품을 한쪽씩 적당히 담으세요.",
    detail: "식사량과 혈당 관리 방법은 담당 의료진의 안내를 우선하세요.",
  },
];

const kidneySafetyCards: FoodCard[] = [
  {
    level: "caution",
    status: "먼저 확인해요",
    ingredient: "개인 맞춤 식단",
    emoji: "🩺",
    headline: "신장 질환은 검사 결과에 따라 식단이 달라져요",
    body: "칼륨, 인, 단백질, 수분 제한 여부를 이 화면에서 임의로 정할 수 없어요.",
    detail: "담당 의료진이나 임상영양사가 정한 식단을 먼저 확인해 주세요.",
  },
  {
    level: "good",
    status: "도와드릴게요",
    ingredient: "식사 기록",
    emoji: "📝",
    headline: "평소 드시는 음식을 기록해 두세요",
    body: "음식 이름과 양을 적어 두면 의료진에게 더 정확히 설명할 수 있어요.",
    detail: "사진을 찍어 식사 기록으로 남기는 방법도 좋아요.",
  },
];

const normalize = (value: string) => value.trim().toLocaleLowerCase();

function includesAny(values: string[], keywords: string[]) {
  return values.some((value) => {
    const normalized = normalize(value);
    return keywords.some((keyword) => normalized.includes(keyword));
  });
}

function conflictsWithAllergy(card: FoodCard, allergies: string[]) {
  const cardText = normalize(`${card.ingredient} ${card.headline} ${card.body} ${card.detail}`);
  return allergies.some((allergy) => {
    const normalized = normalize(allergy);
    return normalized.length > 0 && cardText.includes(normalized);
  });
}

function buildRecommendationCards(allergies: string[], conditions: string[]): FoodCard[] {
  if (includesAny(conditions, ["신장", "콩팥", "투석"])) {
    return kidneySafetyCards;
  }

  const candidates: FoodCard[] = [];
  if (includesAny(conditions, ["고혈압", "혈압"])) candidates.push(...hypertensionCards);
  if (includesAny(conditions, ["당뇨", "혈당"])) candidates.push(...diabetesCards);
  candidates.push(...generalFoodCards);

  const unique = candidates.filter(
    (card, index, items) =>
      items.findIndex((item) => item.ingredient === card.ingredient) === index,
  );
  const safeCards = unique.filter((card) => !conflictsWithAllergy(card, allergies));

  if (safeCards.length > 0) return safeCards.slice(0, 5);

  return [
    {
      level: "caution",
      status: "확인이 필요해요",
      ingredient: "알레르기 대체 식품",
      emoji: "🛡️",
      headline: "등록한 알레르기와 겹치지 않는 식품을 골라야 해요",
      body: "현재 추천 후보가 등록한 알레르기 정보와 겹쳐 자동으로 제외했어요.",
      detail: "의료진이나 임상영양사에게 안전한 대체 식품을 확인해 주세요.",
    },
  ];
}

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

function Sidebar({
  active,
  onNavigate,
}: {
  active: PageScreen;
  onNavigate: (screen: PageScreen) => void;
}) {
  return (
    <aside className="sidebar" aria-label="서비스 메뉴">
      <div className="brand">
        <span className="brand-mark">SL</span>
        <span>실버렌즈</span>
      </div>
      <nav>
        <button
          className={active === "service" ? "nav-item active" : "nav-item"}
          onClick={() => onNavigate("service")}
        >
          <span aria-hidden="true">⌂</span>
          서비스 소개
        </button>
        <button
          className={active === "team" ? "nav-item active" : "nav-item"}
          onClick={() => onNavigate("team")}
        >
          <span aria-hidden="true">●●</span>
          팀원 소개
        </button>
        <button
          className={active === "chat" || active === "setup" ? "nav-item active" : "nav-item"}
          onClick={() => onNavigate(active === "chat" ? "chat" : "setup")}
        >
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

export default function SilverLensApp() {
  const [screen, setScreen] = useState<PageScreen>("setup");
  const [language, setLanguage] = useState<Language | null>(null);
  const [gender, setGender] = useState<Gender | null>(null);
  const [ageBand, setAgeBand] = useState(70);
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [allergies, setAllergies] = useState<string[]>([]);
  const [conditions, setConditions] = useState<string[]>([]);
  const [showAllergyInput, setShowAllergyInput] = useState(false);
  const [showConditionInput, setShowConditionInput] = useState(false);
  const [cardIndex, setCardIndex] = useState(0);
  const [recordingContext, setRecordingContext] = useState<"setup" | "chat" | null>(null);
  const [recordedUrl, setRecordedUrl] = useState<string | null>(null);
  const [recordingError, setRecordingError] = useState("");
  const [chatInput, setChatInput] = useState("");
  const [aiAnswer, setAiAnswer] = useState("");
  const [chatError, setChatError] = useState("");
  const [isLoadingAnswer, setIsLoadingAnswer] = useState(false);
  const [transcript, setTranscript] = useState("");
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const narrationAudioRef = useRef<HTMLAudioElement | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const initialTtsPlayed = useRef(false);
  const touchStartX = useRef<number | null>(null);

  const nextStep = getNextStep(language, gender, ageConfirmed);
  const activeLanguage = language ?? "ko-KR";

  const speak = useCallback(
    async (text: string, lang: Language = activeLanguage) => {
      if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
      const browserFallback = () => {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = lang;
        utterance.rate = 0.82;
        utterance.pitch = 1.02;
        window.speechSynthesis.speak(utterance);
      };
      try {
        narrationAudioRef.current?.pause();
        const response = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        });
        if (!response.ok) throw new Error("Gemini TTS를 사용할 수 없습니다.");
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        narrationAudioRef.current = audio;
        audio.addEventListener("ended", () => URL.revokeObjectURL(url), { once: true });
        await audio.play();
      } catch {
        browserFallback();
      }
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
      recorder.addEventListener("stop", async () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        if (recordedUrl) URL.revokeObjectURL(recordedUrl);
        setRecordedUrl(URL.createObjectURL(blob));
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        mediaRecorderRef.current = null;
        setRecordingContext(null);
        speak("녹음이 저장되었습니다.", "ko-KR");
        const sttUrl = process.env.NEXT_PUBLIC_STT_API_URL;
        if (sttUrl) {
          try {
            const formData = new FormData();
            formData.append("audio", blob, "recording.webm");
            const response = await fetch(`${sttUrl.replace(/\/$/, "")}/transcribe`, {
              method: "POST",
              body: formData,
            });
            const payload = (await response.json()) as { text?: string; detail?: string };
            if (!response.ok) throw new Error(payload.detail || "음성을 인식하지 못했습니다.");
            const text = payload.text?.trim() || "";
            setTranscript(text);
            if (context === "chat") setChatInput(text);
          } catch {
            setRecordingError(
              "녹음은 저장됐지만 로컬 음성인식 서버에 연결하지 못했습니다.",
            );
          }
        }
      });
      recorder.start();
      setRecordingContext(context);
    } catch {
      setRecordingError("마이크 권한을 허용하면 음성으로 말할 수 있어요.");
    }
  };

  const cards = useMemo(
    () => buildRecommendationCards(allergies, conditions),
    [allergies, conditions],
  );
  const visibleCardIndex = Math.min(cardIndex, cards.length - 1);
  const card = cards[visibleCardIndex];

  const cardTts = useMemo(
    () => `${card.status}. ${card.ingredient}. ${card.headline}. ${card.body} ${card.detail}`,
    [card],
  );

  const moveCard = useCallback(
    (direction: -1 | 1) => {
      const next = (visibleCardIndex + direction + cards.length) % cards.length;
      setCardIndex(next);
      const nextCard = cards[next];
      speak(
        `${nextCard.status}. ${nextCard.ingredient}. ${nextCard.headline}. ${nextCard.body} ${nextCard.detail}`,
        "ko-KR",
      );
    },
    [cards, speak, visibleCardIndex],
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
    setCardIndex(0);
    setScreen("chat");
    const firstCard = cards[0];
    window.setTimeout(
      () =>
        speak(
          `${firstCard.status}. ${firstCard.ingredient}. ${firstCard.headline}. ${firstCard.body} ${firstCard.detail}`,
          "ko-KR",
        ),
      180,
    );
  };

  const askGemini = async () => {
    const cleaned = chatInput.trim();
    if (!cleaned || !/[\p{L}\p{N}]/u.test(cleaned)) {
      setChatError("질문 내용을 한 글자 이상 입력해 주세요.");
      return;
    }

    setChatError("");
    setIsLoadingAnswer(true);
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: cleaned,
          profile: { language: activeLanguage, ageBand, allergies, conditions },
        }),
      });
      const payload = (await response.json()) as { answer?: string; error?: string };
      if (!response.ok || !payload.answer) {
        throw new Error(payload.error || "답변을 불러오지 못했습니다.");
      }
      setAiAnswer(payload.answer);
      setChatInput("");
      speak(payload.answer.replace(/[#*_`>-]/g, " "), activeLanguage);
    } catch (error) {
      setChatError(error instanceof Error ? error.message : "답변을 불러오지 못했습니다.");
    } finally {
      setIsLoadingAnswer(false);
    }
  };

  if (screen === "service" || screen === "team") {
    return (
      <main className="app-shell">
        <Sidebar active={screen} onNavigate={setScreen} />
        <section className="content-page">
          <button className="back-button" onClick={() => setScreen("setup")}>← 대화로 돌아가기</button>
          {screen === "service" ? (
            <>
              <span className="page-kicker">SERVICE</span>
              <h1>실버렌즈 서비스 소개</h1>
              <p className="page-lead">
                타자 입력이 어렵거나 사투리를 사용하는 시니어가 음성·사진·글자로
                식재료 정보를 편하게 물어볼 수 있도록 돕는 AI 서비스입니다.
              </p>
              <div className="intro-grid">
                <article><strong>말로 질문</strong><p>faster-whisper가 로컬 환경에서 음성을 글자로 바꿉니다.</p></article>
                <article><strong>쉬운 설명</strong><p>Gemini 언어 모델이 등록한 건강 정보와 질문을 바탕으로 답합니다.</p></article>
                <article><strong>소리로 안내</strong><p>Gemini 2.5 Flash TTS를 우선 사용하고 브라우저 TTS를 예비 수단으로 사용합니다.</p></article>
              </div>
              <section className="link-placeholder">
                <h2>기준 자료 링크</h2>
                <p>팀에서 확정한 기준 자료 링크를 이 영역에 추가할 수 있습니다.</p>
              </section>
            </>
          ) : (
            <>
              <span className="page-kicker">TEAM</span>
              <h1>팀원 소개</h1>
              <p className="page-lead">이름과 역할이 확정되면 아래 카드의 내용을 바꿔 주세요.</p>
              <div className="team-grid">
                {["팀 리더", "백엔드", "프론트엔드", "허브 관리자"].map((role) => (
                  <article key={role}>
                    <span className="team-avatar" aria-hidden="true">{role.slice(0, 1)}</span>
                    <strong>{role}</strong>
                    <p>이름 및 담당 업무를 입력해 주세요.</p>
                  </article>
                ))}
              </div>
            </>
          )}
        </section>
      </main>
    );
  }

  if (screen === "chat") {
    const isRecording = recordingContext === "chat";
    return (
      <main className="app-shell">
        <Sidebar active="chat" onNavigate={setScreen} />
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

          <div className="recommendation-stage">
            <div className="recommendation-summary">
              <span className="waiting-chip">식재료 정보 대기 중</span>
              <div>
                <h2>먼저 드시기 좋은 선택을 알려드릴게요</h2>
                <p>
                  {conditions.length > 0
                    ? `등록한 질병 정보(${conditions.join(", ")})와 알레르기를 반영한 일반 식생활 안내예요.`
                    : "등록한 알레르기를 제외하고, 균형 잡힌 식사에 도움이 되는 일반 식품을 보여드려요."}
                </p>
              </div>
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
                    <span className="eyebrow">추천 안내</span>
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
                <div className="dots" aria-label={`${visibleCardIndex + 1}번째 정보`}>
                  {cards.map((item, index) => (
                    <button
                      key={`${item.status}-${item.ingredient}`}
                      className={index === visibleCardIndex ? "dot active" : "dot"}
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
            <span>카드를 옮기면 선택한 추천 내용을 자동으로 다시 들려드려요.</span>
          </div>

          <section className="text-chat-panel">
            <label htmlFor="chat-question">글자로 질문하기</label>
            <div>
              <textarea
                id="chat-question"
                value={chatInput}
                onChange={(event) => setChatInput(event.target.value)}
                placeholder="예: 정구지를 많이 먹어도 괜찮나요?"
                maxLength={1000}
              />
              <button onClick={askGemini} disabled={isLoadingAnswer}>
                {isLoadingAnswer ? "답변 준비 중…" : "질문 보내기"}
              </button>
            </div>
            {chatError && <p className="error-message" role="alert">{chatError}</p>}
            {aiAnswer && (
              <article className="ai-answer" aria-live="polite">
                <h2>AI 답변</h2>
                <ReactMarkdown>{aiAnswer}</ReactMarkdown>
                <button onClick={() => speak(aiAnswer.replace(/[#*_`>-]/g, " "), activeLanguage)}>
                  🔊 답변 다시 듣기
                </button>
              </article>
            )}
          </section>

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
          {transcript && <p className="transcript-box">음성 인식 결과: {transcript}</p>}
          {recordingError && <p className="error-message" role="alert">{recordingError}</p>}
          <p className="medical-note">
            🛡 이 내용은 일반 식생활 참고용이며 진단·치료를 대신하지 않아요. 처방받은 식단이 있으면 그 안내를 우선하세요.
          </p>
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
      <Sidebar active="setup" onNavigate={setScreen} />
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
        {transcript && <p className="transcript-box">음성 인식 결과: {transcript}</p>}
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
