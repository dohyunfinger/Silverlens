"use client";

import {
  ChangeEvent,
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
type PageScreen = "setup" | "chat" | "about" | "team";
type ChatTurn = {
  id: string;
  question: string;
  answer: string;
  pages: string[];
  attachmentLabels: string[];
};
type AnswerCard = {
  id: string;
  question: string;
  answer: string;
  content: string;
  attachmentLabels: string[];
  turnIndex: number;
  pageIndex: number;
  pageCount: number;
};
type PendingAudio = {
  blob: Blob;
  duration: number;
  url: string;
};
type PendingImage = {
  file: File;
  url: string;
};

function plainTextFromMarkdown(markdown: string) {
  return markdown
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[`*_>#~|-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function splitByLength(text: string, maxChars: number) {
  const words = text.split(/\s+/).filter(Boolean);
  const chunks: string[] = [];
  let current = "";

  for (const word of words) {
    if (word.length > maxChars) {
      if (current) chunks.push(current);
      for (let index = 0; index < word.length; index += maxChars) {
        chunks.push(word.slice(index, index + maxChars));
      }
      current = "";
      continue;
    }

    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxChars && current) {
      chunks.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

function splitNarrationText(text: string, maxChars = 180) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return [];

  const sentences =
    normalized.match(/[^.!?。！？]+(?:[.!?。！？]+|$)/g)?.map((item) => item.trim()) ??
    [normalized];
  const chunks: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    for (const part of splitByLength(sentence, maxChars)) {
      const candidate = current ? `${current} ${part}` : part;
      if (candidate.length > maxChars && current) {
        chunks.push(current);
        current = part;
      } else {
        current = candidate;
      }
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

function splitAnswerIntoPages(markdown: string, maxChars = 300) {
  const blocks = markdown
    .trim()
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
  const pages: string[] = [];
  let current = "";

  const appendBlock = (block: string) => {
    const candidate = current ? `${current}\n\n${block}` : block;
    if (candidate.length <= maxChars) {
      current = candidate;
      return;
    }
    if (current) pages.push(current);
    current = block;
  };

  for (const block of blocks) {
    if (block.length <= maxChars) {
      appendBlock(block);
      continue;
    }

    const plainParts = splitNarrationText(block, maxChars);
    for (const part of plainParts) appendBlock(part);
  }

  if (current) pages.push(current);
  return pages.length > 0 ? pages : [markdown.trim()];
}

function formatDuration(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function blobToInlineData(blob: Blob): Promise<{ data: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      const value = typeof reader.result === "string" ? reader.result : "";
      const commaIndex = value.indexOf(",");
      if (commaIndex < 0) {
        reject(new Error("첨부 파일을 읽지 못했습니다."));
        return;
      }
      resolve({
        data: value.slice(commaIndex + 1),
        mimeType: blob.type || "application/octet-stream",
      });
    });
    reader.addEventListener("error", () => reject(new Error("첨부 파일을 읽지 못했습니다.")));
    reader.readAsDataURL(blob);
  });
}

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
          className={active === "setup" || active === "chat" ? "nav-item active" : "nav-item"}
          onClick={() => onNavigate(active === "chat" ? "chat" : "setup")}
        >
          <span aria-hidden="true">⌂</span>
          서비스
        </button>
        <button
          className={active === "about" ? "nav-item active" : "nav-item"}
          onClick={() => onNavigate("about")}
        >
          <span aria-hidden="true">▤</span>
          서비스 소개
        </button>
        <button
          className={active === "team" ? "nav-item active" : "nav-item"}
          onClick={() => onNavigate("team")}
        >
          <span aria-hidden="true">●●</span>
          팀원 소개
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
  const [recordingContext, setRecordingContext] = useState<"setup" | "chat" | null>(null);
  const [recordedUrl, setRecordedUrl] = useState<string | null>(null);
  const [pendingAudio, setPendingAudio] = useState<PendingAudio | null>(null);
  const [pendingImage, setPendingImage] = useState<PendingImage | null>(null);
  const [recordingError, setRecordingError] = useState("");
  const [chatInput, setChatInput] = useState("");
  const [chatTurns, setChatTurns] = useState<ChatTurn[]>([]);
  const [answerCardIndex, setAnswerCardIndex] = useState(0);
  const [chatError, setChatError] = useState("");
  const [isLoadingAnswer, setIsLoadingAnswer] = useState(false);
  const [isNarrating, setIsNarrating] = useState(false);
  const [transcript, setTranscript] = useState("");
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const narrationAudioRef = useRef<HTMLAudioElement | null>(null);
  const narrationUrlRef = useRef<string | null>(null);
  const narrationRequestRef = useRef<AbortController | null>(null);
  const narrationFinishRef = useRef<(() => void) | null>(null);
  const narrationSequenceRef = useRef(0);
  const announceTimerRef = useRef<number | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordingStartedAtRef = useRef<number | null>(null);
  const initialTtsPlayed = useRef(false);
  const answerTouchStartX = useRef<number | null>(null);
  const photoInputRef = useRef<HTMLInputElement | null>(null);

  const nextStep = getNextStep(language, gender, ageConfirmed);
  const activeLanguage = language ?? "ko-KR";

  const stopNarration = useCallback(() => {
    narrationSequenceRef.current += 1;
    setIsNarrating(false);

    if (announceTimerRef.current !== null) {
      window.clearTimeout(announceTimerRef.current);
      announceTimerRef.current = null;
    }

    narrationRequestRef.current?.abort();
    narrationRequestRef.current = null;

    const audio = narrationAudioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
      narrationAudioRef.current = null;
    }
    narrationFinishRef.current?.();
    narrationFinishRef.current = null;

    if (narrationUrlRef.current) {
      URL.revokeObjectURL(narrationUrlRef.current);
      narrationUrlRef.current = null;
    }

    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
  }, []);

  const speakWithBrowser = useCallback(
    (text: string, lang: Language = activeLanguage) => {
      if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
      stopNarration();
      const chunks = splitNarrationText(text);
      if (chunks.length === 0) return;

      const sequence = narrationSequenceRef.current;
      setIsNarrating(true);

      const speakChunk = (index: number) => {
        if (sequence !== narrationSequenceRef.current) return;
        if (index >= chunks.length) {
          setIsNarrating(false);
          return;
        }

        const utterance = new SpeechSynthesisUtterance(chunks[index]);
        utterance.lang = lang;
        utterance.rate = 0.82;
        utterance.pitch = 1.02;
        utterance.addEventListener("end", () => speakChunk(index + 1), { once: true });
        utterance.addEventListener(
          "error",
          () => {
            if (sequence === narrationSequenceRef.current) setIsNarrating(false);
          },
          { once: true },
        );
        window.speechSynthesis.speak(utterance);
      };

      speakChunk(0);
    },
    [activeLanguage, stopNarration],
  );

  const speakGeminiAnswer = useCallback(
    async (text: string, lang: Language = activeLanguage) => {
      if (typeof window === "undefined") return;

      stopNarration();
      const sequence = narrationSequenceRef.current;
      const chunks = splitNarrationText(text, 320);
      if (chunks.length === 0) return;
      setIsNarrating(true);

      try {
        for (const chunk of chunks) {
          if (sequence !== narrationSequenceRef.current) return;

          const controller = new AbortController();
          narrationRequestRef.current = controller;
          const response = await fetch("/api/tts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: chunk, language: lang }),
            signal: controller.signal,
          });
          if (!response.ok) throw new Error("Gemini TTS를 사용할 수 없습니다.");

          const blob = await response.blob();
          if (sequence !== narrationSequenceRef.current) return;

          const url = URL.createObjectURL(blob);
          const audio = new Audio(url);
          narrationUrlRef.current = url;
          narrationAudioRef.current = audio;
          narrationRequestRef.current = null;

          await new Promise<void>((resolve, reject) => {
            let settled = false;
            const finish = (error?: Error) => {
              if (settled) return;
              settled = true;
              if (narrationAudioRef.current === audio) {
                narrationAudioRef.current = null;
              }
              if (narrationUrlRef.current === url) {
                URL.revokeObjectURL(url);
                narrationUrlRef.current = null;
              }
              if (narrationFinishRef.current === finish) {
                narrationFinishRef.current = null;
              }
              if (error) reject(error);
              else resolve();
            };
            narrationFinishRef.current = () => finish();
            audio.addEventListener("ended", () => finish(), { once: true });
            audio.addEventListener(
              "error",
              () => finish(new Error("Gemini 음성을 재생하지 못했습니다.")),
              { once: true },
            );
            audio.play().catch((error: unknown) =>
              finish(
                error instanceof Error
                  ? error
                  : new Error("Gemini 음성을 재생하지 못했습니다."),
              ),
            );
          });
        }

        if (sequence === narrationSequenceRef.current) {
          setIsNarrating(false);
        }
      } catch {
        if (sequence !== narrationSequenceRef.current) return;
        narrationRequestRef.current = null;
        speakWithBrowser(text, lang);
      }
    },
    [activeLanguage, speakWithBrowser, stopNarration],
  );

  const queueBrowserNarration = useCallback(
    (text: string, lang: Language, delay: number) => {
      stopNarration();
      announceTimerRef.current = window.setTimeout(() => {
        announceTimerRef.current = null;
        speakWithBrowser(text, lang);
      }, delay);
    },
    [speakWithBrowser, stopNarration],
  );

  useEffect(() => {
    if (initialTtsPlayed.current) return;
    initialTtsPlayed.current = true;
    queueBrowserNarration(promptCopy["ko-KR"].language, "ko-KR", 450);
  }, [queueBrowserNarration]);

  useEffect(() => {
    return () => {
      if (recordedUrl) URL.revokeObjectURL(recordedUrl);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      stopNarration();
    };
  }, [recordedUrl, stopNarration]);

  useEffect(() => {
    return () => {
      if (pendingAudio) URL.revokeObjectURL(pendingAudio.url);
    };
  }, [pendingAudio]);

  useEffect(() => {
    return () => {
      if (pendingImage) URL.revokeObjectURL(pendingImage.url);
    };
  }, [pendingImage]);

  const announceNext = useCallback(
    (
      nextLanguage: Language | null = language,
      nextGender: Gender | null = gender,
      nextAgeConfirmed: boolean = ageConfirmed,
    ) => {
      const step = getNextStep(nextLanguage, nextGender, nextAgeConfirmed);
      const lang = nextLanguage ?? "ko-KR";
      queueBrowserNarration(promptCopy[lang][step], lang, 80);
    },
    [ageConfirmed, gender, language, queueBrowserNarration],
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
      stopNarration();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      recordingStartedAtRef.current = Date.now();
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      });
      recorder.addEventListener("stop", async () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        const url = URL.createObjectURL(blob);
        const duration = Math.max(
          1,
          Math.round((Date.now() - (recordingStartedAtRef.current ?? Date.now())) / 1000),
        );
        if (context === "chat") {
          setPendingAudio({ blob, duration, url });
          queueBrowserNarration(
            "음성이 첨부되었습니다. 사진이나 글을 더한 뒤 질문 보내기 버튼을 눌러 주세요.",
            activeLanguage,
            80,
          );
        } else {
          setRecordedUrl(url);
        }
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        mediaRecorderRef.current = null;
        recordingStartedAtRef.current = null;
        setRecordingContext(null);
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
              "음성은 첨부됐지만 글자로 미리보는 기능에 연결하지 못했습니다. 그대로 함께 보낼 수 있어요.",
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

  const beginChat = () => {
    if (nextStep !== "complete") {
      announceNext();
      return;
    }
    stopNarration();
    setScreen("chat");
  };

  const answerCards = useMemo<AnswerCard[]>(
    () =>
      chatTurns.flatMap((turn, turnIndex) =>
        turn.pages.map((content, pageIndex) => ({
          id: `${turn.id}-${pageIndex}`,
          question: turn.question,
          answer: turn.answer,
          content,
          attachmentLabels: turn.attachmentLabels,
          turnIndex,
          pageIndex,
          pageCount: turn.pages.length,
        })),
      ),
    [chatTurns],
  );
  const visibleAnswerCardIndex = Math.min(
    answerCardIndex,
    Math.max(0, answerCards.length - 1),
  );
  const activeAnswerCard = answerCards[visibleAnswerCardIndex];

  const moveAnswerCard = useCallback(
    (direction: -1 | 1) => {
      if (answerCards.length === 0) return;
      stopNarration();
      setAnswerCardIndex((current) =>
        Math.min(answerCards.length - 1, Math.max(0, current + direction)),
      );
    },
    [answerCards.length, stopNarration],
  );

  const handleAnswerTouchStart = (event: TouchEvent) => {
    answerTouchStartX.current = event.touches[0]?.clientX ?? null;
  };

  const handleAnswerTouchEnd = (event: TouchEvent) => {
    if (answerTouchStartX.current === null) return;
    const endX = event.changedTouches[0]?.clientX ?? answerTouchStartX.current;
    const distance = endX - answerTouchStartX.current;
    answerTouchStartX.current = null;
    if (Math.abs(distance) < 45) return;
    moveAnswerCard(distance < 0 ? 1 : -1);
  };

  const handlePhoto = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setChatError("사진 파일만 첨부할 수 있어요.");
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setChatError("사진은 8MB 이하로 선택해 주세요.");
      return;
    }
    setChatError("");
    setPendingImage({ file, url: URL.createObjectURL(file) });
    queueBrowserNarration(
      "사진이 첨부되었습니다. 음성이나 글을 더한 뒤 질문 보내기 버튼을 눌러 주세요.",
      activeLanguage,
      80,
    );
  };

  const clearPendingAudio = () => {
    setPendingAudio(null);
    setTranscript("");
  };

  const clearPendingImage = () => {
    setPendingImage(null);
  };

  const askGemini = async () => {
    const cleaned = chatInput.trim();
    const hasMeaningfulText = Boolean(cleaned && /[\p{L}\p{N}]/u.test(cleaned));
    if (!hasMeaningfulText && !pendingAudio && !pendingImage) {
      setChatError("글, 음성, 사진 중 하나 이상을 준비해 주세요.");
      return;
    }

    setChatError("");
    setIsLoadingAnswer(true);
    try {
      const [audio, image] = await Promise.all([
        pendingAudio ? blobToInlineData(pendingAudio.blob) : null,
        pendingImage ? blobToInlineData(pendingImage.file) : null,
      ]);
      const attachmentLabels = [
        ...(pendingAudio ? [`🎙 음성 ${formatDuration(pendingAudio.duration)}`] : []),
        ...(pendingImage ? ["🖼 사진 1장"] : []),
      ];
      const questionLabel =
        cleaned ||
        (pendingAudio && pendingImage
          ? "음성과 사진으로 질문"
          : pendingAudio
            ? "음성으로 질문"
            : "사진으로 질문");
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: cleaned,
          audio,
          image,
          profile: { language: activeLanguage, ageBand, allergies, conditions },
        }),
      });
      const payload = (await response.json()) as { answer?: string; error?: string };
      if (!response.ok || !payload.answer) {
        throw new Error(payload.error || "답변을 불러오지 못했습니다.");
      }
      const nextTurn: ChatTurn = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        question: questionLabel,
        answer: payload.answer,
        pages: splitAnswerIntoPages(payload.answer),
        attachmentLabels,
      };
      setAnswerCardIndex(answerCards.length);
      setChatTurns((turns) => [...turns, nextTurn]);
      setChatInput("");
      setPendingAudio(null);
      setPendingImage(null);
      setTranscript("");
      void speakGeminiAnswer(plainTextFromMarkdown(payload.answer), activeLanguage);
    } catch (error) {
      setChatError(error instanceof Error ? error.message : "답변을 불러오지 못했습니다.");
    } finally {
      setIsLoadingAnswer(false);
    }
  };

  if (screen === "about" || screen === "team") {
    return (
      <main className="app-shell">
        <Sidebar active={screen} onNavigate={setScreen} />
        <section className="content-page placeholder-page">
          <button className="back-button" onClick={() => setScreen("setup")}>← 서비스로 돌아가기</button>
          <div>
            <h1>{screen === "about" ? "서비스 소개" : "팀원 소개"}</h1>
            <p>구성중</p>
          </div>
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

          <section className="answer-section" aria-live="polite">
            <div className="answer-heading">
              <span className="answer-label">AI 답변</span>
              <span className={isLoadingAnswer ? "answer-state waiting" : "answer-state"}>
                {isLoadingAnswer
                  ? "답변 만드는 중"
                  : activeAnswerCard
                    ? `대화 ${activeAnswerCard.turnIndex + 1} · 답변 ${
                        activeAnswerCard.pageIndex + 1
                      }/${activeAnswerCard.pageCount}`
                    : "답변 대기 중"}
              </span>
            </div>

            <div
              className="answer-carousel"
              onTouchStart={handleAnswerTouchStart}
              onTouchEnd={handleAnswerTouchEnd}
            >
              <button
                className="answer-arrow"
                onClick={() => moveAnswerCard(-1)}
                disabled={!activeAnswerCard || visibleAnswerCardIndex === 0}
                aria-label="이전 대화 또는 이전 답변"
              >
                ‹
              </button>
              <article className="answer-card">
                {activeAnswerCard ? (
                  <>
                    <div className="answer-question">
                      <span>내 질문</span>
                      <strong>{activeAnswerCard.question}</strong>
                    </div>
                    {activeAnswerCard.attachmentLabels.length > 0 && (
                      <div className="answer-attachments" aria-label="함께 보낸 첨부">
                        {activeAnswerCard.attachmentLabels.map((label) => (
                          <span key={label}>{label}</span>
                        ))}
                      </div>
                    )}
                    <div className="answer-markdown">
                      <ReactMarkdown>{activeAnswerCard.content}</ReactMarkdown>
                    </div>
                  </>
                ) : (
                  <div className="answer-placeholder">
                    <strong>질문을 보내면 답변을 큰 글자로 보여드려요.</strong>
                    <p>
                      답변이 길면 오른쪽 카드로 이어지고, 왼쪽으로 넘기면
                      이전 대화를 다시 볼 수 있어요.
                    </p>
                  </div>
                )}
              </article>
              <button
                className="answer-arrow"
                onClick={() => moveAnswerCard(1)}
                disabled={
                  !activeAnswerCard ||
                  visibleAnswerCardIndex === answerCards.length - 1
                }
                aria-label="다음 답변 또는 새 대화"
              >
                ›
              </button>
            </div>

            <div className="answer-history-footer">
              <span>← 이전 대화</span>
              <div className="answer-dots" aria-label="답변 카드 선택">
                {answerCards.map((item, index) => (
                  <button
                    key={item.id}
                    className={index === visibleAnswerCardIndex ? "active" : ""}
                    onClick={() => {
                      stopNarration();
                      setAnswerCardIndex(index);
                    }}
                    aria-label={`${item.turnIndex + 1}번째 대화 ${item.pageIndex + 1}번째 답변`}
                  />
                ))}
              </div>
              <span>이어지는 답변 →</span>
            </div>

            <button
              className="answer-replay"
              disabled={!activeAnswerCard}
              onClick={() => {
                if (isNarrating) {
                  stopNarration();
                  return;
                }
                if (activeAnswerCard) {
                  void speakGeminiAnswer(
                    plainTextFromMarkdown(activeAnswerCard.answer),
                    activeLanguage,
                  );
                }
              }}
            >
              {isNarrating ? "■ 답변 재생 멈추기" : "🔊 현재 답변 다시 듣기"}
            </button>
          </section>

          <section className="question-composer" aria-label="질문 작성">
            <label htmlFor="chat-question">글자로 질문하기</label>
            <textarea
              id="chat-question"
              value={chatInput}
              onChange={(event) => setChatInput(event.target.value)}
              placeholder="예: 정구지를 많이 먹어도 괜찮나요?"
              maxLength={1000}
              rows={3}
            />

            {(pendingAudio || pendingImage) && (
              <div className="pending-attachments" aria-label="전송 대기 중인 첨부">
                <strong>함께 보낼 내용</strong>
                <div className="attachment-list">
                  {pendingAudio && (
                    <div className="attachment-chip">
                      <span className="attachment-icon">🎙️</span>
                      <span>
                        <strong>음성 첨부됨</strong>
                        <small>{formatDuration(pendingAudio.duration)} · 보내기 전</small>
                      </span>
                      <button onClick={clearPendingAudio} aria-label="첨부한 음성 삭제">×</button>
                    </div>
                  )}
                  {pendingImage && (
                    <div className="attachment-chip">
                      <span className="attachment-icon">🖼️</span>
                      <span>
                        <strong>사진 첨부됨</strong>
                        <small>{pendingImage.file.name}</small>
                      </span>
                      <button onClick={clearPendingImage} aria-label="첨부한 사진 삭제">×</button>
                    </div>
                  )}
                </div>
                {transcript && <p>음성 인식: {transcript}</p>}
                <p>아직 전송되지 않았어요. 질문 보내기를 누르면 한꺼번에 올라가요.</p>
              </div>
            )}

            <div className="composer-actions">
              <button
                className={isRecording ? "composer-tool recording" : "composer-tool"}
                onClick={() => toggleRecording("chat")}
              >
                <span>{isRecording ? "●" : "🎙️"}</span>
                <strong>{isRecording ? "녹음 중" : "음성 녹음"}</strong>
                <small>{isRecording ? "다시 누르면 첨부" : "녹음만으로 전송되지 않아요"}</small>
              </button>
              <button className="composer-tool" onClick={() => photoInputRef.current?.click()}>
                <span>📷</span>
                <strong>사진 올리기</strong>
                <small>음성과 함께 보낼 수 있어요</small>
              </button>
              <input
                ref={photoInputRef}
                className="visually-hidden"
                type="file"
                accept="image/png,image/jpeg,image/webp,image/heic,image/heif"
                capture="environment"
                onChange={handlePhoto}
                aria-label="사진 파일 선택"
              />
              <button
                className="send-question"
                onClick={askGemini}
                disabled={
                  isLoadingAnswer ||
                  (!chatInput.trim() && !pendingAudio && !pendingImage)
                }
              >
                <span>➤</span>
                <strong>{isLoadingAnswer ? "한꺼번에 보내는 중" : "질문 보내기"}</strong>
                <small>글·음성·사진을 함께 전송</small>
              </button>
            </div>
          </section>

          {chatError && <p className="error-message" role="alert">{chatError}</p>}
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
