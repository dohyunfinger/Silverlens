"use client";

import Image from "next/image";
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
import {
  getHealthLabel,
  getHealthOptions,
  makeStoredHealthId,
  type HealthKind,
} from "../backend/data/healthTerms";

type Language = "ko-KR" | "en-US" | "zh-CN";
type Gender = "male" | "female";
type SetupStep = "language" | "gender" | "age" | "complete";
type PageScreen = "setup" | "chat" | "about" | "team";
type RecordingContext = "setup" | "chat" | "allergy" | "condition";
type NarrationStatus = "preparing" | "ready" | "error";
type ChatTurn = {
  id: string;
  question: string;
  answer: string;
  pages: string[];
  attachmentLabels: string[];
  riskLevel: "danger" | "caution" | "safe";
  warningMessage: string;
};
type AnswerCard = {
  id: string;
  turnId: string;
  question: string;
  content: string;
  attachmentLabels: string[];
  turnIndex: number;
  pageIndex: number;
  pageCount: number;
  riskLevel: "danger" | "caution" | "safe";
  warningMessage: string;
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
type VoiceAnalysis = {
  text: string;
  allergies: string[];
  conditions: string[];
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

function splitAnswerIntoPages(markdown: string, maxChars = 210) {
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

function uniqueItems(items: string[]) {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))];
}

function narrationPagesForTurn(turn: ChatTurn) {
  if (!turn.warningMessage || turn.pages.length === 0) return turn.pages;
  return turn.pages.map((page, index) =>
    index === 0 ? `${turn.warningMessage}\n\n${page}` : page,
  );
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
        mimeType: (blob.type || "application/octet-stream").split(";")[0],
      });
    });
    reader.addEventListener("error", () => reject(new Error("첨부 파일을 읽지 못했습니다.")));
    reader.readAsDataURL(blob);
  });
}

function writeAscii(view: DataView, offset: number, value: string) {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

function audioBufferToWav(buffer: AudioBuffer) {
  const sampleRate = buffer.sampleRate;
  const samples = buffer.length;
  const bytesPerSample = 2;
  const wav = new ArrayBuffer(44 + samples * bytesPerSample);
  const view = new DataView(wav);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + samples * bytesPerSample, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, samples * bytesPerSample, true);

  const channels = Array.from(
    { length: buffer.numberOfChannels },
    (_, index) => buffer.getChannelData(index),
  );
  let offset = 44;
  for (let sampleIndex = 0; sampleIndex < samples; sampleIndex += 1) {
    const mixed =
      channels.reduce((sum, channel) => sum + channel[sampleIndex], 0) /
      channels.length;
    const clamped = Math.max(-1, Math.min(1, mixed));
    view.setInt16(
      offset,
      clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff,
      true,
    );
    offset += bytesPerSample;
  }

  return wav;
}

async function convertRecordingToWav(blob: Blob) {
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(await blob.arrayBuffer());
    return new Blob([audioBufferToWav(decoded)], { type: "audio/wav" });
  } catch {
    throw new Error("음성을 전송 가능한 형식으로 바꾸지 못했습니다. 다시 녹음해 주세요.");
  } finally {
    await context.close();
  }
}

const languages: Array<{
  id: Language;
  flag: string;
  label: string;
  tts: string;
}> = [
  { id: "ko-KR", flag: "🇰🇷", label: "한국어", tts: "한국어" },
  { id: "en-US", flag: "🇺🇸", label: "English", tts: "English" },
  { id: "zh-CN", flag: "🇨🇳", label: "中文", tts: "中文" },
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
  "zh-CN": {
    language: "请选择使用语言。",
    gender: "请选择性别。",
    age: "请上下滑动选择年龄段。",
    complete: "基本设置已完成。您可以添加过敏和疾病信息。",
  },
};

const automaticNoticeCopy: Record<
  Language,
  { audioAttached: string; photoAttached: string }
> = {
  "ko-KR": {
    audioAttached: "음성이 첨부되었습니다. 사진이나 글을 더한 뒤 질문 보내기 버튼을 눌러 주세요.",
    photoAttached: "사진이 첨부되었습니다. 음성이나 글을 더한 뒤 질문 보내기 버튼을 눌러 주세요.",
  },
  "en-US": {
    audioAttached: "Your recording is attached. Add a photo or text if needed, then press Send question.",
    photoAttached: "Your photo is attached. Add a recording or text if needed, then press Send question.",
  },
  "zh-CN": {
    audioAttached: "语音已添加。您可以继续添加照片或文字，然后点击发送问题。",
    photoAttached: "照片已添加。您可以继续添加语音或文字，然后点击发送问题。",
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

function ProjectSheet({
  src,
  alt,
  width,
  height,
  index,
  title,
  className = "",
  priority = false,
}: {
  src: string;
  alt: string;
  width: number;
  height: number;
  index: string;
  title: string;
  className?: string;
  priority?: boolean;
}) {
  return (
    <figure className={`case-sheet ${className}`.trim()}>
      <Image
        src={src}
        alt={alt}
        width={width}
        height={height}
        priority={priority}
        sizes="(max-width: 760px) 92vw, 46vw"
      />
      <figcaption>
        <span>{index}</span>
        {title}
      </figcaption>
    </figure>
  );
}

function ServiceIntroduction({ onBack }: { onBack: () => void }) {
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
  }, []);

  return (
    <main className="case-page">
      <nav className="case-nav" aria-label="소개 페이지 메뉴">
        <button className="case-wordmark" onClick={onBack} aria-label="SilverLens 서비스로 돌아가기">
          <span>SL</span>
          <strong>SILVERLENS</strong>
        </button>
        <span className="case-nav-label">AI FOOD GUIDE FOR SENIORS · 2026</span>
        <button className="case-exit" onClick={onBack}>
          서비스로 돌아가기 <span aria-hidden="true">↗</span>
        </button>
      </nav>

      <header className="case-hero">
        <div className="case-hero-meta">
          <span>01 — SERVICE STORY</span>
          <span>VOICE · CONTEXT · SAFETY</span>
        </div>
        <h1>
          <span>말은 편하게,</span>
          <em>식사는 더 안전하게.</em>
        </h1>
        <div className="case-hero-bottom">
          <p>
            SilverLens는 시니어가 익숙한 말로 음식과 식재료를 물어볼 수 있도록 돕는
            AI 식품 안내 서비스입니다.
          </p>
          <a href="#case-story">
            프로젝트 보기 <span aria-hidden="true">↓</span>
          </a>
        </div>
      </header>

      <section className="case-cover" id="case-story">
        <div className="case-cover-label">
          <span>THE BEGINNING</span>
          <strong>NAVER OGQ<br />AI COMPETITION</strong>
          <small>Project archive / 01</small>
        </div>
        <ProjectSheet
          src="/intro/11-KakaoTalk_20260719_233408809-1-.jpg"
          alt="제4회 NAVER OGQ마켓 AI Competition 기획안 표지"
          width={1344}
          height={1907}
          index="00"
          title="Competition Proposal"
          className="case-cover-sheet"
          priority
        />
        <div className="case-cover-copy">
          <span className="case-section-number">01</span>
          <h2>기술보다 먼저,<br />사람의 말에 귀 기울였습니다.</h2>
          <p>
            타이핑이 어렵거나 익숙한 표현으로 질문하는 사용자도 음식 정보를 편하게
            확인할 수 있도록, 질문부터 답변까지의 흐름을 단순하게 설계했습니다.
          </p>
          <ul>
            <li><span>01</span> 말로 묻는 간편한 질문</li>
            <li><span>02</span> 방언과 시장 표현의 문맥 이해</li>
            <li><span>03</span> 건강정보를 고려한 식품 안내</li>
          </ul>
        </div>
      </section>

      <section className="case-manifesto">
        <span className="case-vertical-label">SILVERLENS / BRAND PHILOSOPHY</span>
        <div>
          <p className="case-kicker">OUR POINT OF VIEW</p>
          <h2>
            익숙한 한마디가<br />
            <em>안심할 수 있는 한 끼</em>로<br />
            이어지도록.
          </h2>
        </div>
        <p className="case-manifesto-copy">
          SilverLens는 복잡한 기능보다 큰 글씨, 분명한 선택, 음성 안내와 짧은 답변을
          우선합니다. 사용자의 질문 맥락과 등록한 건강정보를 함께 보고, 필요한 경우
          주의 메시지를 먼저 보여주는 방향으로 설계했습니다.
        </p>
      </section>

      <section className="case-doc-grid case-doc-grid--opening" aria-label="프로젝트 기획 자료">
        <ProjectSheet
          src="/intro/10-KakaoTalk_20260719_233408809_01-1-.jpg"
          alt="대회 기획안 Executive Summary"
          width={1379}
          height={1483}
          index="01"
          title="Executive Summary"
        />
        <ProjectSheet
          src="/intro/01-KakaoTalk_20260719_233408809_02-1-.jpg"
          alt="대회 기획안 비전 및 목적"
          width={1262}
          height={1477}
          index="02"
          title="Vision & Purpose"
          className="case-sheet--lower"
        />
      </section>

      <section className="case-word-band" aria-label="SilverLens 핵심 가치">
        <span>VOICE FIRST</span>
        <span>CONTEXT AWARE</span>
        <span>SAFETY VISIBLE</span>
      </section>

      <section className="case-feature-doc">
        <div className="case-feature-copy">
          <span className="case-section-number">02</span>
          <p className="case-kicker">THE FRAMEWORK</p>
          <h2>문제를 이해하고,<br />실행 가능한 흐름으로.</h2>
          <p>
            공모전의 배경과 운영 구조를 바탕으로, SilverLens는 실제 사용 화면과
            음성 중심 경험을 구현하는 프로젝트로 구체화했습니다.
          </p>
        </div>
        <ProjectSheet
          src="/intro/09-KakaoTalk_20260719_233408809_03-1-.jpg"
          alt="제4회 NAVER OGQ마켓 AI Competition 대회 개요"
          width={1272}
          height={1119}
          index="03"
          title="Competition Overview"
          className="case-sheet--wide"
        />
      </section>

      <section className="case-color-block">
        <div>
          <span>01</span>
          <strong>말하기</strong>
          <small>Voice Input</small>
        </div>
        <div>
          <span>02</span>
          <strong>이해하기</strong>
          <small>Dialect &amp; Context</small>
        </div>
        <div>
          <span>03</span>
          <strong>안내하기</strong>
          <small>Food Guidance</small>
        </div>
      </section>

      <section className="case-doc-grid case-doc-grid--balanced">
        <ProjectSheet
          src="/intro/02-KakaoTalk_20260719_233408809_04-1-.jpg"
          alt="대회 주제 세부 트랙 예시"
          width={1155}
          height={1378}
          index="04"
          title="Project Track"
        />
        <ProjectSheet
          src="/intro/08-KakaoTalk_20260719_233408809_05-1-.jpg"
          alt="대회 선발 프로세스"
          width={1250}
          height={1719}
          index="05"
          title="Selection Process"
        />
      </section>

      <section className="case-quote">
        <span aria-hidden="true">“</span>
        <blockquote>
          복잡한 기술을 보여주는 대신,<br />
          누구나 <em>한 번에 이해할 수 있는 경험</em>을 만듭니다.
        </blockquote>
        <p>SILVERLENS DESIGN PRINCIPLE</p>
      </section>

      <section className="case-doc-grid case-doc-grid--editorial">
        <ProjectSheet
          src="/intro/13-KakaoTalk_20260719_233408809_06-1-.jpg"
          alt="대회 제출 항목과 1차 선발 안내"
          width={1251}
          height={1773}
          index="06"
          title="Submission Guide"
          className="case-sheet--warm"
        />
        <ProjectSheet
          src="/intro/12-KakaoTalk_20260719_233408809_07-1-.jpg"
          alt="대회 코칭 및 본선 안내"
          width={1200}
          height={955}
          index="07"
          title="Coaching & Final"
          className="case-sheet--float"
        />
      </section>

      <section className="case-dark-section">
        <div className="case-dark-heading">
          <p className="case-kicker">QUALITY &amp; RESPONSIBILITY</p>
          <h2>완성도와 안전,<br />두 가지를 함께 봅니다.</h2>
          <p>
            실제 작동 여부와 사용성뿐 아니라 개인정보, 저작권, AI 생성물 표기와
            미성년자 안전까지 함께 확인하는 기준을 프로젝트 설계에 반영합니다.
          </p>
        </div>
        <div className="case-dark-docs">
          <ProjectSheet
            src="/intro/04-KakaoTalk_20260719_233408809_08-1-.jpg"
            alt="대회 심사 기준"
            width={1212}
            height={1063}
            index="08"
            title="Evaluation Criteria"
          />
          <ProjectSheet
            src="/intro/07-KakaoTalk_20260719_233408809_09-1-.jpg"
            alt="대회 시상 및 후속 지원"
            width={1227}
            height={1162}
            index="09"
            title="Awards & Support"
          />
        </div>
      </section>

      <section className="case-doc-grid case-doc-grid--closing">
        <ProjectSheet
          src="/intro/03-KakaoTalk_20260719_233408809_10-1-.jpg"
          alt="대회 홍보 및 모집 전략"
          width={1230}
          height={967}
          index="10"
          title="Promotion Strategy"
        />
        <ProjectSheet
          src="/intro/06-KakaoTalk_20260719_233408809_11-1-.jpg"
          alt="대회 조직 운영 체계와 리스크 관리"
          width={1210}
          height={1365}
          index="11"
          title="Operation & Risk"
          className="case-sheet--lower"
        />
      </section>

      <section className="case-timeline">
        <div className="case-timeline-copy">
          <span className="case-section-number">03</span>
          <p className="case-kicker">FROM IDEA TO SERVICE</p>
          <h2>기획에서 구현까지,<br />하나의 경험으로 연결합니다.</h2>
          <p>
            프로젝트의 일정과 목표를 한눈에 확인하고, 사용자에게 필요한 기능을
            단계별로 구현합니다.
          </p>
        </div>
        <ProjectSheet
          src="/intro/05-KakaoTalk_20260719_233408809_12-1-.jpg"
          alt="대회 전체 타임라인"
          width={1260}
          height={1191}
          index="12"
          title="Project Timeline"
          className="case-sheet--timeline"
        />
      </section>

      <section className="case-final">
        <p>THE SENIOR-FRIENDLY AI FOOD ASSISTANT</p>
        <h2>SilverLens</h2>
        <p className="case-final-message">
          음식이 궁금한 순간,<br />
          가장 편한 말로 물어보세요.
        </p>
        <button onClick={onBack}>
          SilverLens 시작하기 <span aria-hidden="true">→</span>
        </button>
      </section>

      <footer className="case-footer">
        <strong>SILVERLENS</strong>
        <span>VOICE-FIRST FOOD GUIDANCE</span>
        <span>PROJECT ARCHIVE · 2026</span>
      </footer>
    </main>
  );
}

export default function SilverLensApp() {
  const [screen, setScreen] = useState<PageScreen>("setup");
  const [language, setLanguage] = useState<Language | null>(null);
  const [gender, setGender] = useState<Gender | null>(null);
  const [ageBand, setAgeBand] = useState(70);
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [allergyIds, setAllergyIds] = useState<string[]>([]);
  const [conditionIds, setConditionIds] = useState<string[]>([]);
  const [autoVoiceGuide, setAutoVoiceGuide] = useState(true);
  const [voicePreferenceReady, setVoicePreferenceReady] = useState(false);
  const [showAllergyInput, setShowAllergyInput] = useState(false);
  const [showConditionInput, setShowConditionInput] = useState(false);
  const [recordingContext, setRecordingContext] = useState<RecordingContext | null>(null);
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
  const [isTranscribingVoice, setIsTranscribingVoice] = useState(false);
  const [narrationStatus, setNarrationStatus] = useState<Record<string, NarrationStatus>>({});
  const [profileVoiceNotice, setProfileVoiceNotice] = useState("");
  const [transcript, setTranscript] = useState("");
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const narrationAudioRef = useRef<HTMLAudioElement | null>(null);
  const narrationUrlRef = useRef<string | null>(null);
  const narrationFinishRef = useRef<(() => void) | null>(null);
  const narrationChunksRef = useRef<
    Map<string, Array<Array<Promise<Blob>>>>
  >(new Map());
  const narrationControllersRef = useRef<Set<AbortController>>(new Set());
  const narrationSequenceRef = useRef(0);
  const announceTimerRef = useRef<number | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordingStartedAtRef = useRef<number | null>(null);
  const initialTtsPlayed = useRef(false);
  const answerTouchStartX = useRef<number | null>(null);
  const photoInputRef = useRef<HTMLInputElement | null>(null);

  const nextStep = getNextStep(language, gender, ageConfirmed);
  const activeLanguage = language ?? "ko-KR";
  const allergyOptions = useMemo(
    () => getHealthOptions("allergy", activeLanguage),
    [activeLanguage],
  );
  const conditionOptions = useMemo(
    () => getHealthOptions("condition", activeLanguage),
    [activeLanguage],
  );
  const localizedAllergies = useMemo(
    () => allergyIds.map((id) => getHealthLabel(id, activeLanguage)),
    [activeLanguage, allergyIds],
  );
  const localizedConditions = useMemo(
    () => conditionIds.map((id) => getHealthLabel(id, activeLanguage)),
    [activeLanguage, conditionIds],
  );

  const stopNarration = useCallback(() => {
    narrationSequenceRef.current += 1;
    setIsNarrating(false);

    if (announceTimerRef.current !== null) {
      window.clearTimeout(announceTimerRef.current);
      announceTimerRef.current = null;
    }

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

  const fetchNarrationChunk = useCallback(async (text: string, lang: Language) => {
    const controller = new AbortController();
    narrationControllersRef.current.add(controller);
    try {
      const response = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, language: lang }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error || "Gemini TTS를 사용할 수 없습니다.");
      }
      return await response.blob();
    } finally {
      narrationControllersRef.current.delete(controller);
    }
  }, []);

  const prepareGeminiAnswer = useCallback(
    (turnId: string, pages: string[], lang: Language = activeLanguage) => {
      const cacheKey = `${turnId}:${lang}`;
      const cached = narrationChunksRef.current.get(cacheKey);
      if (cached) return cached;

      const pageRequests = pages.map((page) =>
        splitNarrationText(plainTextFromMarkdown(page), 210).map((chunk) =>
          fetchNarrationChunk(chunk, lang),
        ),
      );
      const allRequests = pageRequests.flat();
      if (allRequests.length === 0) return [];

      setNarrationStatus((current) => ({ ...current, [turnId]: "preparing" }));
      narrationChunksRef.current.set(cacheKey, pageRequests);

      void Promise.all(allRequests).then(
        () => {
          setNarrationStatus((current) => ({ ...current, [turnId]: "ready" }));
        },
        () => {
          narrationChunksRef.current.delete(cacheKey);
          setNarrationStatus((current) => ({ ...current, [turnId]: "error" }));
        },
      );
      return pageRequests;
    },
    [activeLanguage, fetchNarrationChunk],
  );

  const speakAnswerPagesWithBrowser = useCallback(
    (
      pages: string[],
      startPage: number,
      firstCardIndex: number,
      lang: Language = activeLanguage,
    ) => {
      if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
      stopNarration();
      const sequence = narrationSequenceRef.current;
      setIsNarrating(true);

      const speakPage = (pageIndex: number) => {
        if (sequence !== narrationSequenceRef.current) return;
        if (pageIndex >= pages.length) {
          setIsNarrating(false);
          return;
        }
        setAnswerCardIndex(firstCardIndex + pageIndex);
        const chunks = splitNarrationText(
          plainTextFromMarkdown(pages[pageIndex]),
        );

        const speakChunk = (chunkIndex: number) => {
          if (sequence !== narrationSequenceRef.current) return;
          if (chunkIndex >= chunks.length) {
            speakPage(pageIndex + 1);
            return;
          }
          const utterance = new SpeechSynthesisUtterance(chunks[chunkIndex]);
          utterance.lang = lang;
          utterance.rate = 0.82;
          utterance.pitch = 1.02;
          utterance.addEventListener(
            "end",
            () => speakChunk(chunkIndex + 1),
            { once: true },
          );
          utterance.addEventListener(
            "error",
            () => {
              if (sequence === narrationSequenceRef.current) {
                setIsNarrating(false);
              }
            },
            { once: true },
          );
          window.speechSynthesis.speak(utterance);
        };

        if (chunks.length === 0) speakPage(pageIndex + 1);
        else speakChunk(0);
      };

      speakPage(startPage);
    },
    [activeLanguage, stopNarration],
  );

  const speakGeminiAnswer = useCallback(
    async (
      turnId: string,
      pages: string[],
      startPage: number,
      firstCardIndex: number,
      lang: Language = activeLanguage,
    ) => {
      if (typeof window === "undefined") return;

      stopNarration();
      const sequence = narrationSequenceRef.current;
      const pageRequests = prepareGeminiAnswer(turnId, pages, lang);
      if (pageRequests.length === 0) return;

      try {
        for (
          let pageIndex = startPage;
          pageIndex < pageRequests.length;
          pageIndex += 1
        ) {
          if (sequence !== narrationSequenceRef.current) return;
          setAnswerCardIndex(firstCardIndex + pageIndex);

          for (const chunkRequest of pageRequests[pageIndex]) {
            if (sequence !== narrationSequenceRef.current) return;
            const blob = await chunkRequest;
            if (sequence !== narrationSequenceRef.current) return;

            const url = URL.createObjectURL(blob);
            const audio = new Audio(url);
            narrationUrlRef.current = url;
            narrationAudioRef.current = audio;
            setIsNarrating(true);

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
        }

        if (sequence === narrationSequenceRef.current) {
          setIsNarrating(false);
        }
      } catch {
        if (sequence !== narrationSequenceRef.current) return;
        setNarrationStatus((current) => ({ ...current, [turnId]: "error" }));
        speakAnswerPagesWithBrowser(
          pages,
          startPage,
          firstCardIndex,
          lang,
        );
      }
    },
    [
      activeLanguage,
      prepareGeminiAnswer,
      speakAnswerPagesWithBrowser,
      stopNarration,
    ],
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

  const queueAutomaticNarration = useCallback(
    (text: string, lang: Language, delay: number) => {
      if (!autoVoiceGuide) return;
      queueBrowserNarration(text, lang, delay);
    },
    [autoVoiceGuide, queueBrowserNarration],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const stored = window.localStorage.getItem("silverlens:auto-voice-guide");
      const enabled = stored !== "off";
      setAutoVoiceGuide(enabled);
      if (!enabled) initialTtsPlayed.current = true;
      setVoicePreferenceReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!voicePreferenceReady || !autoVoiceGuide || initialTtsPlayed.current) return;
    initialTtsPlayed.current = true;
    queueBrowserNarration(promptCopy["ko-KR"].language, "ko-KR", 450);
  }, [autoVoiceGuide, queueBrowserNarration, voicePreferenceReady]);

  useEffect(() => {
    const narrationControllers = narrationControllersRef.current;
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      narrationControllers.forEach((controller) => controller.abort());
      narrationControllers.clear();
      stopNarration();
    };
  }, [stopNarration]);

  useEffect(() => {
    return () => {
      if (recordedUrl) URL.revokeObjectURL(recordedUrl);
    };
  }, [recordedUrl]);

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
      queueAutomaticNarration(promptCopy[lang][step], lang, 80);
    },
    [ageConfirmed, gender, language, queueAutomaticNarration],
  );

  const toggleAutoVoiceGuide = () => {
    const next = !autoVoiceGuide;
    setAutoVoiceGuide(next);
    window.localStorage.setItem(
      "silverlens:auto-voice-guide",
      next ? "on" : "off",
    );
    if (!next) {
      stopNarration();
      return;
    }
    const step = getNextStep(language, gender, ageConfirmed);
    queueBrowserNarration(promptCopy[activeLanguage][step], activeLanguage, 80);
  };

  const replayCurrentGuide = () => {
    const step = getNextStep(language, gender, ageConfirmed);
    queueBrowserNarration(promptCopy[activeLanguage][step], activeLanguage, 20);
  };

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

  const addHealthTag = (
    event: KeyboardEvent<HTMLInputElement>,
    kind: HealthKind,
    setter: React.Dispatch<React.SetStateAction<string[]>>,
  ) => {
    if (event.key !== "Enter") return;
    const value = event.currentTarget.value.trim();
    if (!value) return;
    event.preventDefault();
    const storedId = makeStoredHealthId(kind, value);
    setter((items) => (items.includes(storedId) ? items : [...items, storedId]));
    event.currentTarget.value = "";
  };

  const stopRecording = () => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
  };

  const normalizeDialectLocally = useCallback(async (text: string) => {
    const dialectUrl = process.env.NEXT_PUBLIC_DIALECT_API_URL;
    const isLocalBrowser =
      typeof window !== "undefined" &&
      (window.location.hostname === "localhost" ||
        window.location.hostname === "127.0.0.1");
    if (!dialectUrl || !isLocalBrowser || !text.trim()) return text;

    try {
      const response = await fetch(`${dialectUrl.replace(/\/$/, "")}/normalize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const payload = (await response.json()) as {
        normalized?: string;
        detail?: string;
      };
      if (!response.ok || !payload.normalized?.trim()) return text;
      return payload.normalized.trim();
    } catch {
      return text;
    }
  }, []);

  const transcribeRecording = useCallback(async (
    blob: Blob,
    purpose: RecordingContext,
  ): Promise<VoiceAnalysis> => {
    let uploadBlob = blob;
    try {
      uploadBlob = await convertRecordingToWav(blob);
    } catch {
      // 브라우저가 변환하지 못하는 형식은 원래 녹음 형식으로 전송합니다.
    }
    const audio = await blobToInlineData(uploadBlob);
    const response = await fetch("/api/transcribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ audio, purpose, language: activeLanguage }),
    });
    const payload = (await response.json()) as {
      text?: string;
      allergies?: string[];
      conditions?: string[];
      error?: string;
    };
    if (!response.ok || !payload.text?.trim()) {
      throw new Error(payload.error || "음성을 인식하지 못했습니다.");
    }
    return {
      text: payload.text.trim(),
      allergies: uniqueItems(payload.allergies ?? []),
      conditions: uniqueItems(payload.conditions ?? []),
    };
  }, [activeLanguage]);

  const toggleRecording = async (context: RecordingContext) => {
    setRecordingError("");
    setProfileVoiceNotice("");
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
      if (context === "chat") setTranscript("");
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
          queueAutomaticNarration(
            automaticNoticeCopy[activeLanguage].audioAttached,
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
        setIsTranscribingVoice(true);
        if (context !== "chat") {
          setProfileVoiceNotice("음성을 글자로 바꾸고 있어요. 잠시만 기다려 주세요.");
        }
        try {
            const analysis = await transcribeRecording(blob, context);
            const text =
              context === "chat"
                ? await normalizeDialectLocally(analysis.text)
                : analysis.text;
            setTranscript(text);
            if (context === "chat") {
              setChatInput(text);
            } else {
              setAllergyIds((current) =>
                uniqueItems([...current, ...analysis.allergies]),
              );
              setConditionIds((current) =>
                uniqueItems([...current, ...analysis.conditions]),
              );
              setShowAllergyInput(false);
              setShowConditionInput(false);
              const total =
                analysis.allergies.length + analysis.conditions.length;
              setProfileVoiceNotice(
                total > 0
                  ? `AI가 음성을 확인해 알레르기 ${analysis.allergies.length}개, 질병 ${analysis.conditions.length}개를 나누어 입력했어요.`
                  : "음성에서 분명하게 말한 알레르기나 질병 정보를 찾지 못했어요.",
              );
            }
        } catch (error) {
          setRecordingError(
            context === "chat"
              ? "음성은 첨부됐지만 글자로 미리보지 못했습니다. 음성 자체는 함께 보낼 수 있어요."
              : error instanceof Error
                ? error.message
                : "음성을 글자로 바꾸지 못했습니다. 다시 말해 주세요.",
          );
          if (context !== "chat") setProfileVoiceNotice("");
        } finally {
          setIsTranscribingVoice(false);
        }
      });
      recorder.start();
      setRecordingContext(context);
    } catch {
      setRecordingError("마이크 권한을 허용하면 음성으로 말할 수 있어요.");
    }
  };

  const beginChat = () => {
    if (isTranscribingVoice) {
      setProfileVoiceNotice("건강정보를 입력하고 있어요. 잠시만 기다려 주세요.");
      return;
    }
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
            turnId: turn.id,
          question: turn.question,
          content,
          attachmentLabels: turn.attachmentLabels,
          turnIndex,
          pageIndex,
          pageCount: turn.pages.length,
          riskLevel: turn.riskLevel,
          warningMessage: turn.warningMessage,
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
    queueAutomaticNarration(
      automaticNoticeCopy[activeLanguage].photoAttached,
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
        pendingAudio
          ? convertRecordingToWav(pendingAudio.blob).then(blobToInlineData)
          : null,
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
          profile: {
            language: activeLanguage,
            ageBand,
            allergies: localizedAllergies,
            conditions: localizedConditions,
            allergyIds,
            conditionIds,
          },
          history: chatTurns.slice(-6).map((turn) => ({
            question: turn.question,
            answer: turn.answer,
          })),
        }),
      });
      const payload = (await response.json()) as {
        answer?: string;
        riskLevel?: "danger" | "caution" | "safe";
        warningMessage?: string;
        error?: string;
      };
      if (!response.ok || !payload.answer) {
        throw new Error(payload.error || "답변을 불러오지 못했습니다.");
      }
      const nextTurn: ChatTurn = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        question: questionLabel,
        answer: payload.answer,
        pages: splitAnswerIntoPages(payload.answer),
        attachmentLabels,
        riskLevel: payload.riskLevel ?? "safe",
        warningMessage: payload.warningMessage?.trim() ?? "",
      };
      const narrationPages = narrationPagesForTurn(nextTurn);
      setAnswerCardIndex(answerCards.length);
      setChatTurns((turns) => [...turns, nextTurn]);
      setChatInput("");
      setPendingAudio(null);
      setPendingImage(null);
      setTranscript("");
      prepareGeminiAnswer(nextTurn.id, narrationPages, activeLanguage);
      if (autoVoiceGuide) {
        void speakGeminiAnswer(
          nextTurn.id,
          narrationPages,
          0,
          answerCards.length,
          activeLanguage,
        );
      }
    } catch (error) {
      setChatError(error instanceof Error ? error.message : "답변을 불러오지 못했습니다.");
    } finally {
      setIsLoadingAnswer(false);
    }
  };

  if (screen === "about") {
    return <ServiceIntroduction onBack={() => setScreen("setup")} />;
  }

  if (screen === "team") {
    return (
      <main className="app-shell">
        <Sidebar active={screen} onNavigate={setScreen} />
        <section className="content-page placeholder-page">
          <button className="back-button" onClick={() => setScreen("setup")}>← 서비스로 돌아가기</button>
          <div>
            <h1>팀원 소개</h1>
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
                    {activeAnswerCard.warningMessage && (
                      <div
                        className={`answer-warning ${activeAnswerCard.riskLevel}`}
                        role="alert"
                      >
                        <span aria-hidden="true">!</span>
                        <div>
                          <strong>
                            {activeLanguage === "en-US"
                              ? activeAnswerCard.riskLevel === "danger"
                                ? "Food warning"
                                : "Check before eating"
                              : activeLanguage === "zh-CN"
                                ? activeAnswerCard.riskLevel === "danger"
                                  ? "食用警告"
                                  : "食用前确认"
                                : activeAnswerCard.riskLevel === "danger"
                                  ? "섭취 경고"
                                  : "섭취 전 확인"}
                          </strong>
                          <p>{activeAnswerCard.warningMessage}</p>
                        </div>
                      </div>
                    )}
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
                  const turn = chatTurns[activeAnswerCard.turnIndex];
                  const firstCardIndex =
                    visibleAnswerCardIndex - activeAnswerCard.pageIndex;
                  if (!turn) return;
                  const narrationPages = narrationPagesForTurn(turn);
                  if (narrationStatus[activeAnswerCard.turnId] === "error") {
                    speakAnswerPagesWithBrowser(
                      narrationPages,
                      activeAnswerCard.pageIndex,
                      firstCardIndex,
                      activeLanguage,
                    );
                    return;
                  }
                  void speakGeminiAnswer(
                    activeAnswerCard.turnId,
                    narrationPages,
                    activeAnswerCard.pageIndex,
                    firstCardIndex,
                    activeLanguage,
                  );
                }
              }}
            >
              {isNarrating
                ? "■ 답변 재생 멈추기"
                : activeAnswerCard &&
                    narrationStatus[activeAnswerCard.turnId] === "preparing"
                  ? "⏳ 음성 준비 중 · 준비 후 바로 재생"
                  : activeAnswerCard &&
                      narrationStatus[activeAnswerCard.turnId] === "ready"
                    ? "🔊 답변 다시 듣기 · 즉시 재생"
                    : "🔊 현재 답변 다시 듣기"}
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
  const canStart = nextStep === "complete" && !isTranscribingVoice;
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

        <button
          className={autoVoiceGuide ? "auto-tts enabled" : "auto-tts disabled"}
          onClick={toggleAutoVoiceGuide}
          aria-pressed={autoVoiceGuide}
        >
          <span aria-hidden="true">{autoVoiceGuide ? "🔊" : "🔇"}</span>
          <span>
            <strong>자동 음성 안내 {autoVoiceGuide ? "켜짐" : "꺼짐"}</strong>
            <small>누르면 {autoVoiceGuide ? "자동 재생을 끕니다" : "자동 재생을 켭니다"}</small>
          </span>
          <em aria-hidden="true">{autoVoiceGuide ? "ON" : "OFF"}</em>
        </button>

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
            <div className="health-actions">
              <button onClick={() => setShowAllergyInput((value) => !value)}>＋ 직접 입력</button>
              <button
                className={recordingContext === "allergy" ? "recording" : ""}
                onClick={() => toggleRecording("allergy")}
                disabled={isTranscribingVoice}
              >
                {recordingContext === "allergy" ? "■ 녹음 완료" : "🎙 말해서 입력"}
              </button>
            </div>
            {showAllergyInput && (
              <input
                autoFocus
                placeholder="입력 후 엔터"
                list="allergy-health-options"
                onKeyDown={(event) =>
                  addHealthTag(event, "allergy", setAllergyIds)
                }
                aria-label="알레르기 음식 입력"
              />
            )}
            <datalist id="allergy-health-options">
              {allergyOptions.map((item) => (
                <option key={item.id} value={item.label} />
              ))}
            </datalist>
            <div className="tag-list">
              {allergyIds.map((id) => (
                <button key={id} onClick={() => setAllergyIds((items) => items.filter((value) => value !== id))}>
                  {getHealthLabel(id, activeLanguage)} ×
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
            <div className="health-actions">
              <button onClick={() => setShowConditionInput((value) => !value)}>＋ 직접 입력</button>
              <button
                className={recordingContext === "condition" ? "recording" : ""}
                onClick={() => toggleRecording("condition")}
                disabled={isTranscribingVoice}
              >
                {recordingContext === "condition" ? "■ 녹음 완료" : "🎙 말해서 입력"}
              </button>
            </div>
            {showConditionInput && (
              <input
                autoFocus
                placeholder="입력 후 엔터"
                list="condition-health-options"
                onKeyDown={(event) =>
                  addHealthTag(event, "condition", setConditionIds)
                }
                aria-label="질병 정보 입력"
              />
            )}
            <datalist id="condition-health-options">
              {conditionOptions.map((item) => (
                <option key={item.id} value={item.label} />
              ))}
            </datalist>
            <div className="tag-list">
              {conditionIds.map((id) => (
                <button key={id} onClick={() => setConditionIds((items) => items.filter((value) => value !== id))}>
                  {getHealthLabel(id, activeLanguage)} ×
                </button>
              ))}
            </div>
          </section>
        </div>
        <p className="health-language-note">
          DATA에 등록된 건강정보는 선택한 언어에 맞춰 표시됩니다.
        </p>

        <div className="voice-row">
          <button
            className={setupRecording ? "voice-control recording" : "voice-control"}
            onClick={() => toggleRecording("setup")}
          >
            <span>{setupRecording ? "●" : "🎙️"}</span>
            <div>
              <strong>{setupRecording ? "녹음 중" : "건강정보 한 번에 말하기"}</strong>
              <small>{setupRecording ? "다시 누르면 자동 입력" : "알레르기와 질병을 함께 말해요"}</small>
            </div>
          </button>
          <button className="replay-control" onClick={replayCurrentGuide}>
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
        {profileVoiceNotice && (
          <p className="profile-voice-notice" role="status">{profileVoiceNotice}</p>
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
