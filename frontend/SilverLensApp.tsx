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
import { clearStore, describeStore, readStore, writeStore } from "./localStore";
import { type PhotoIssue, preparePhoto } from "./photoCapture";
import {
  getHealthGroupOptions,
  getHealthLabel,
  getHealthOptions,
  makeStoredHealthId,
  type HealthKind,
} from "../backend/data/healthTerms";

type Language = "ko-KR" | "en-US" | "ja-JP";
type Gender = "male" | "female";
type SetupStep = "language" | "gender" | "age" | "complete";
type PageScreen = "setup" | "chat" | "about";
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
/**
 * 사진을 찍기 전에 고른 촬영 목적.
 * 같은 사진이라도 성분표를 읽어야 할 때와 음식을 알아봐야 할 때 볼 곳이 달라서,
 * 촬영 안내와 AI 지시를 함께 나눈다.
 */
type PhotoPurpose = "label" | "food" | "medicine";
type PendingImage = {
  file: File;
  url: string;
  purpose: PhotoPurpose | null;
  /** 밝기·흔들림 검사 결과. 검사를 못 했으면 null. */
  issues: PhotoIssue[] | null;
  width: number;
  height: number;
  byteSize: number;
};
type VoiceAnalysis = {
  text: string;
  allergies: string[];
  conditions: string[];
  /** 말로 직접 밝힌 성별. 말하지 않았으면 null. */
  gender: Gender | null;
  /** 말로 밝힌 나이대(40~90). 말하지 않았으면 null. */
  ageBand: number | null;
};
/**
 * 목록으로 고를 수 없는 상세 사정을 음성 그대로 남겨 둔 메모.
 * 예) "견과류 중에 특히 호두가 안 맞아요"
 */
type HealthNote = {
  id: string;
  kind: "allergy" | "condition" | "setup";
  text: string;
  savedAt: number;
};
/**
 * 답변 음성은 한 조각이 곧 API 호출 한 번이다.
 * 무료 한도를 아끼려고 조각을 미리 만들지 않고, 재생 순서가 됐을 때 부르는
 * 함수 형태로 들고 있다가 한 번 만든 결과는 재사용한다.
 */
type NarrationChunkRequest = () => Promise<Blob>;
type NarrationPageRequests = NarrationChunkRequest[][];

/**
 * 서버 TTS는 글자 수에 거의 비례해 생성 시간이 늘어난다.
 * 실측(ko-KR): 19자 약 5초, 59자 약 8초, 178자 약 20초.
 * 그래서 맨 처음 듣는 조각만 짧게 떼어 첫 소리를 빨리 내보내고,
 * 나머지는 길게 묶어 요청 수(무료 한도)를 아낀다.
 */
const NARRATION_LEAD_IN_CHARS = 70;
const NARRATION_CHUNK_CHARS = 210;
/** 현재 조각을 재생하는 동안 미리 만들어 둘 다음 조각 수. */
const NARRATION_PREFETCH_AHEAD = 2;

function splitNarrationForSpeech(text: string, withLeadIn: boolean) {
  const chunks = splitNarrationText(text, NARRATION_CHUNK_CHARS);
  if (!withLeadIn || chunks.length === 0) return chunks;

  const [first, ...rest] = chunks;
  if (first.length <= NARRATION_LEAD_IN_CHARS) return chunks;

  const leadParts = splitNarrationText(first, NARRATION_LEAD_IN_CHARS);
  if (leadParts.length <= 1) return chunks;
  // 앞부분만 잘라내고 남은 조각은 다시 하나로 합쳐 요청 수가 늘어나지 않게 한다.
  return [leadParts[0], leadParts.slice(1).join(" "), ...rest];
}

function lazyNarrationChunk(factory: () => Promise<Blob>): NarrationChunkRequest {
  let pending: Promise<Blob> | null = null;
  return () => {
    if (!pending) {
      pending = factory().catch((error: unknown) => {
        // 실패한 요청은 캐시하지 않아 다음 재생에서 다시 시도할 수 있게 한다.
        pending = null;
        throw error;
      });
    }
    return pending;
  };
}

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
  label: string;
  tts: string;
}> = [
  { id: "ko-KR", label: "한국어", tts: "한국어" },
  { id: "en-US", label: "English", tts: "English" },
  { id: "ja-JP", label: "日本語", tts: "日本語" },
];

/*
 * 국기 아이콘.
 *
 * 국기 이모지(🇰🇷)는 Windows 데스크톱에서 국기 그림이 아니라 "KR" 같은
 * 지역 문자 두 개로 보인다. 폰트가 국기 조합을 지원하지 않기 때문이고
 * 웹에서 고칠 수 없다. 그래서 SVG 로 직접 그린다.
 *
 * 국기는 규격이 정해져 있으므로 눈대중으로 그리지 않고 비율을 그대로 옮겼다.
 * 모두 가로:세로 = 3:2 이고 좌표계는 36 x 24 를 쓴다.
 */

/** 깃면 좌표계. 세 국기 모두 3:2 라서 같은 값을 쓴다. */
const FLAG_WIDTH = 36;
const FLAG_HEIGHT = 24;

/**
 * 태극기 네 괘.
 *
 * 괘는 깃면의 두 대각선 위에 놓이고, 막대는 그 대각선과 직각을 이룬다.
 * 대각선 기울기가 atan(24/36) ≈ 33.69° 이므로 막대 회전각은 그것의 직각인
 * 56.31° 다. 배치는 왼쪽 위 건(☰), 오른쪽 위 감(☵), 왼쪽 아래 리(☲),
 * 오른쪽 아래 곤(☷) 이다. bars 의 true 는 이어진 막대, false 는 끊긴 막대다.
 */
/**
 * 태극 축이 깃면 대각선과 나란해지도록 돌리는 각도.
 * 대각선 기울기가 atan(24/36) ≈ 33.69° 이므로, 세로로 그린 태극을
 * 그 직각인 56.31° 만큼 돌리면 대각선과 나란해진다.
 */
const TAEGEUK_AXIS = 90 - 33.69;
/** 괘 하나의 길이는 태극 지름(12)의 1/2 이다. */
const TRIGRAM_BAR_LENGTH = 6;
/** 막대 두께는 길이의 1/6, 막대 사이 간격은 그 절반이다. */
const TRIGRAM_BAR_THICKNESS = 1;
const TRIGRAM_BAR_GAP = 0.5;
/**
 * 끊긴 막대의 가운데 빈칸.
 * 규격 비율은 막대 길이의 1/12(=0.5)인데, 24px 아이콘에서는 0.3px 이 되어
 * 건(이어짐)과 곤(끊김)이 구별되지 않는다. 그래서 0.9 로만 살짝 넓혔다.
 */
const TRIGRAM_BREAK_GAP = 0.9;
/** 깃면 중심에서 괘 중심까지의 거리. 참고 도안의 22 를 이 좌표계로 옮긴 값. */
const TRIGRAM_DISTANCE = 11;

const trigrams = (["heaven", "water", "fire", "earth"] as const).map((name) => {
  // 각 괘가 어느 모서리로 가는지(가로·세로 방향)와 막대 구성.
  const layout = {
    heaven: { dx: -1, dy: -1, bars: [true, true, true] },
    water: { dx: 1, dy: -1, bars: [false, true, false] },
    fire: { dx: -1, dy: 1, bars: [true, false, true] },
    earth: { dx: 1, dy: 1, bars: [false, false, false] },
  }[name];
  const diagonal = Math.hypot(FLAG_WIDTH / 2, FLAG_HEIGHT / 2);
  return {
    name,
    bars: layout.bars,
    x: FLAG_WIDTH / 2 + (layout.dx * (FLAG_WIDTH / 2) * TRIGRAM_DISTANCE) / diagonal,
    y: FLAG_HEIGHT / 2 + (layout.dy * (FLAG_HEIGHT / 2) * TRIGRAM_DISTANCE) / diagonal,
    // 같은 대각선에 있는 두 괘는 같은 각도를 쓴다. 막대는 대각선과 직각이다.
    angle: layout.dx * layout.dy > 0 ? -TAEGEUK_AXIS : TAEGEUK_AXIS,
  };
});

function LanguageFlag({ id }: { id: Language }) {
  // 흰 바탕 국기가 흰 배경에 묻히지 않도록 아주 옅은 테두리를 두른다.
  const frame = (
    <rect
      x=".5"
      y=".5"
      width={FLAG_WIDTH - 1}
      height={FLAG_HEIGHT - 1}
      rx="2"
      fill="none"
      stroke="rgba(0, 0, 0, .22)"
    />
  );
  const svgProps = {
    className: "flag-icon",
    viewBox: `0 0 ${FLAG_WIDTH} ${FLAG_HEIGHT}`,
    "aria-hidden": true,
    focusable: "false" as const,
  };

  if (id === "en-US") {
    /*
     * 성조기: 붉은 줄과 흰 줄 13개(맨 위와 맨 아래가 붉은 줄),
     * 남색 칸은 가로의 2/5 · 세로의 7/13, 별 50개는 6개·5개 줄이 번갈아 9줄.
     */
    const stripe = FLAG_HEIGHT / 13;
    const cantonWidth = (FLAG_WIDTH * 2) / 5;
    const cantonHeight = stripe * 7;
    const stars: Array<{ cx: number; cy: number }> = [];
    for (let row = 1; row <= 9; row += 1) {
      const isLongRow = row % 2 === 1;
      const columns = isLongRow ? [1, 3, 5, 7, 9, 11] : [2, 4, 6, 8, 10];
      for (const column of columns) {
        stars.push({
          cx: (cantonWidth * column) / 12,
          cy: (cantonHeight * row) / 10,
        });
      }
    }
    return (
      <svg {...svgProps}>
        <rect width={FLAG_WIDTH} height={FLAG_HEIGHT} rx="2" fill="#fff" />
        <g fill="#b22234">
          {[0, 2, 4, 6, 8, 10, 12].map((row) => (
            <rect key={row} y={row * stripe} width={FLAG_WIDTH} height={stripe} />
          ))}
        </g>
        <rect width={cantonWidth} height={cantonHeight} fill="#3c3b6e" />
        <g fill="#fff">
          {stars.map((star) => (
            <circle key={`${star.cx}-${star.cy}`} cx={star.cx} cy={star.cy} r=".42" />
          ))}
        </g>
        {frame}
      </svg>
    );
  }

  if (id === "ja-JP") {
    // 일장기: 붉은 원의 지름은 세로의 3/5 이고 정중앙에 놓인다.
    return (
      <svg {...svgProps}>
        <rect width={FLAG_WIDTH} height={FLAG_HEIGHT} rx="2" fill="#fff" />
        <circle
          cx={FLAG_WIDTH / 2}
          cy={FLAG_HEIGHT / 2}
          r={(FLAG_HEIGHT * 3) / 10}
          fill="#bc002d"
        />
        {frame}
      </svg>
    );
  }

  /*
   * 태극기.
   *
   * 태극의 지름은 세로의 1/2(=12)이고 작은 두 반원은 그 절반이다.
   * 태극의 축은 건(왼쪽 위)과 곤(오른쪽 아래)을 잇는 대각선과 나란하고,
   * 붉은 쪽 머리가 건 쪽, 푸른 쪽 머리가 곤 쪽을 향한다.
   *
   * 아래 세 도형의 구성은 flag-icons 프로젝트(MIT)의 kr.svg 도안을 참고해
   * 이 좌표계(36x24)로 옮긴 것이다. 손으로 어림잡으면 태극 문양이 틀어진다.
   */
  return (
    <svg {...svgProps}>
      <rect width={FLAG_WIDTH} height={FLAG_HEIGHT} rx="2" fill="#fff" />
      <g transform={`rotate(${-TAEGEUK_AXIS} 18 12)`}>
        {/* 붉은 쪽: 축을 기준으로 한쪽 반원 */}
        <path d="M18 6A6 6 0 0 1 18 18Z" fill="#cd2e3a" />
        {/* 푸른 쪽: 반대쪽 반원에, 아래에서 붉은 쪽을 파고드는 반원을 더한 것 */}
        <path d="M18 6A6 6 0 0 0 18 18A3 3 0 0 0 18 12Z" fill="#0047a0" />
        {/* 붉은 쪽이 위에서 푸른 쪽을 파고드는 반원 */}
        <circle cx="18" cy="9" r="3" fill="#cd2e3a" />
      </g>
      <g fill="#0f1419">
        {trigrams.map((trigram) => (
          <g
            key={trigram.name}
            transform={`translate(${trigram.x} ${trigram.y}) rotate(${trigram.angle})`}
          >
            {trigram.bars.map((solid, barIndex) => {
              const y =
                (barIndex - 1) * (TRIGRAM_BAR_THICKNESS + TRIGRAM_BAR_GAP) -
                TRIGRAM_BAR_THICKNESS / 2;
              if (solid) {
                return (
                  <rect
                    key={barIndex}
                    x={-TRIGRAM_BAR_LENGTH / 2}
                    y={y}
                    width={TRIGRAM_BAR_LENGTH}
                    height={TRIGRAM_BAR_THICKNESS}
                  />
                );
              }
              const half = (TRIGRAM_BAR_LENGTH - TRIGRAM_BREAK_GAP) / 2;
              return (
                <g key={barIndex}>
                  <rect
                    x={-TRIGRAM_BAR_LENGTH / 2}
                    y={y}
                    width={half}
                    height={TRIGRAM_BAR_THICKNESS}
                  />
                  <rect
                    x={TRIGRAM_BREAK_GAP / 2}
                    y={y}
                    width={half}
                    height={TRIGRAM_BAR_THICKNESS}
                  />
                </g>
              );
            })}
          </g>
        ))}
      </g>
      {frame}
    </svg>
  );
}

/** 시니어 서비스라 실제로 쓰이는 구간만 큰 버튼으로 노출한다. (앞뒤는 이하·이상으로 묶음) */
const ageChoices = [40, 50, 60, 70, 80, 90];

/**
 * 자주 묻는 질문 버튼.
 *
 * 빈 입력창은 어르신에게 부담이 커서 첫 질문을 못 던지는 경우가 많다.
 * 그래서 바로 누를 수 있는 예시를 두고, 사진 버튼은 질문을 보내는 대신
 * 카메라를 연다. 문구는 주제 이탈 판정(isLikelyOnTopic)을 통과하도록
 * 음식·건강 낱말을 반드시 포함시켰다.
 */
type QuickAsk = {
  id: string;
  icon: string;
  action: "photo" | "ask";
  label: Record<Language, string>;
  question?: Record<Language, string>;
};

const quickAsks: QuickAsk[] = [
  {
    id: "photo",
    icon: "📷",
    action: "photo",
    label: {
      "ko-KR": "사진으로 물어보기",
      "en-US": "Ask with a photo",
      "ja-JP": "写真で聞く",
    },
  },
  {
    id: "medicine",
    icon: "💊",
    action: "ask",
    label: {
      "ko-KR": "약과 안 맞는 음식",
      "en-US": "Foods that clash with my medicine",
      "ja-JP": "薬と合わない食べ物",
    },
    question: {
      "ko-KR": "제가 먹는 약과 같이 먹으면 안 되는 음식이 뭔가요?",
      "en-US": "Which foods should I avoid with the medicine I take?",
      "ja-JP": "私が飲んでいる薬と一緒に食べてはいけない食品は何ですか？",
    },
  },
  {
    id: "soft-food",
    icon: "🥣",
    action: "ask",
    label: {
      "ko-KR": "부드럽게 먹는 방법",
      "en-US": "How to make food softer",
      "ja-JP": "やわらかく食べる方法",
    },
    question: {
      "ko-KR": "씹기 편하게 음식을 부드럽게 조리하는 방법을 알려주세요.",
      "en-US": "Please tell me how to cook food softer so it is easier to chew.",
      "ja-JP": "かみやすいように食べ物をやわらかく調理する方法を教えてください。",
    },
  },
  {
    id: "today-meal",
    icon: "🍚",
    action: "ask",
    label: {
      "ko-KR": "오늘 뭐 먹을까요",
      "en-US": "What should I eat today",
      "ja-JP": "今日は何を食べましょう",
    },
    question: {
      "ko-KR": "제 건강 정보에 맞는 오늘 반찬을 추천해 주세요.",
      "en-US": "Please recommend side dishes for today that suit my health information.",
      "ja-JP": "私の健康情報に合う今日のおかずをおすすめしてください。",
    },
  },
];

/** 등록 질병에 맞춰 하나만 더 붙이는 버튼. safety_rules 의 질병 ID를 그대로 쓴다. */
const conditionQuickAsks: Array<{ conditionIds: string[] } & QuickAsk> = [
  {
    id: "diabetes",
    icon: "🩸",
    action: "ask",
    conditionIds: ["condition_diabetes"],
    label: {
      "ko-KR": "혈당 안 오르는 반찬",
      "en-US": "Side dishes that keep blood sugar steady",
      "ja-JP": "血糖が上がりにくいおかず",
    },
    question: {
      "ko-KR": "혈당이 천천히 오르는 반찬을 알려주세요.",
      "en-US": "Please tell me side dishes that raise blood sugar slowly.",
      "ja-JP": "血糖がゆっくり上がるおかずを教えてください。",
    },
  },
  {
    id: "kidney",
    icon: "💧",
    action: "ask",
    conditionIds: ["condition_kidney_disease", "condition_dialysis"],
    label: {
      "ko-KR": "칼륨 적은 채소",
      "en-US": "Vegetables low in potassium",
      "ja-JP": "カリウムが少ない野菜",
    },
    question: {
      "ko-KR": "칼륨이 적어서 신장에 부담이 덜한 채소를 알려주세요.",
      "en-US": "Please tell me vegetables low in potassium that are gentler on the kidneys.",
      "ja-JP": "カリウムが少なく腎臓の負担が軽い野菜を教えてください。",
    },
  },
  {
    id: "dysphagia",
    icon: "🥄",
    action: "ask",
    conditionIds: ["condition_dysphagia"],
    label: {
      "ko-KR": "삼키기 쉬운 음식",
      "en-US": "Foods that are easy to swallow",
      "ja-JP": "飲み込みやすい食べ物",
    },
    question: {
      "ko-KR": "삼키기 쉽게 만드는 음식과 조리법을 알려주세요.",
      "en-US": "Please tell me foods and cooking methods that are easy to swallow.",
      "ja-JP": "飲み込みやすい食べ物と調理法を教えてください。",
    },
  },
  {
    id: "hypertension",
    icon: "🧂",
    action: "ask",
    conditionIds: ["condition_hypertension", "condition_heart_failure"],
    label: {
      "ko-KR": "싱겁게 먹는 방법",
      "en-US": "How to eat with less salt",
      "ja-JP": "薄味で食べる方法",
    },
    question: {
      "ko-KR": "짜지 않게 간을 맞추면서 맛있게 먹는 방법을 알려주세요.",
      "en-US": "Please tell me how to season food tastily with less salt.",
      "ja-JP": "塩を減らしても おいしく味つけする方法を教えてください。",
    },
  },
  {
    id: "gout",
    icon: "🦶",
    action: "ask",
    conditionIds: ["condition_gout"],
    label: {
      "ko-KR": "통풍에 피할 음식",
      "en-US": "Foods to avoid with gout",
      "ja-JP": "痛風で避ける食べ物",
    },
    question: {
      "ko-KR": "통풍이 있을 때 피해야 할 음식을 알려주세요.",
      "en-US": "Please tell me which foods to avoid when I have gout.",
      "ja-JP": "痛風があるときに避けるべき食べ物を教えてください。",
    },
  },
  {
    id: "anticoagulant",
    icon: "🩹",
    action: "ask",
    conditionIds: ["condition_anticoagulant"],
    label: {
      "ko-KR": "와파린과 음식",
      "en-US": "Warfarin and food",
      "ja-JP": "ワルファリンと食事",
    },
    question: {
      "ko-KR": "와파린을 먹을 때 조심해야 할 음식을 알려주세요.",
      "en-US": "Please tell me which foods need care while taking warfarin.",
      "ja-JP": "ワルファリンを飲むときに気をつける食品を教えてください。",
    },
  },
  {
    id: "osteoporosis",
    icon: "🦴",
    action: "ask",
    conditionIds: ["condition_osteoporosis"],
    label: {
      "ko-KR": "뼈에 좋은 음식",
      "en-US": "Foods good for bones",
      "ja-JP": "骨に良い食べ物",
    },
    question: {
      "ko-KR": "뼈 건강에 도움이 되는 음식을 알려주세요.",
      "en-US": "Please tell me foods that help bone health.",
      "ja-JP": "骨の健康に役立つ食べ物を教えてください。",
    },
  },
];
const narrationRateOptions = [
  { label: { "ko-KR": "아주 천천히", "en-US": "Very slow", "ja-JP": "とてもゆっくり" }, value: 0.72 },
  { label: { "ko-KR": "조금 느리게", "en-US": "A little slow", "ja-JP": "少しゆっくり" }, value: 0.82 },
  { label: { "ko-KR": "보통", "en-US": "Normal", "ja-JP": "ふつう" }, value: 0.95 },
  { label: { "ko-KR": "조금 빠르게", "en-US": "A little fast", "ja-JP": "少し速く" }, value: 1.08 },
  { label: { "ko-KR": "빠르게", "en-US": "Fast", "ja-JP": "速く" }, value: 1.2 },
] as const;

/** 기본값은 "보통". */
const DEFAULT_RATE_INDEX = 2;
const NARRATION_RATE_STORAGE_KEY = "silverlens:narration-rate-index-v2";
const HEALTH_NOTES_STORAGE_KEY = "silverlens:health-notes-v1";
const PROFILE_STORE_KEY = "state-v1";
/** 대화 이력은 최근 것만 남긴다. 오래된 것까지 두면 저장 용량이 계속 늘어난다. */
const MAX_STORED_TURNS = 30;
const BACKUP_FILE_NAME = "silverlens-backup.json";

/** 기기에 저장하는 내용. 답변 음성은 다시 만들 수 있어 저장하지 않는다. */
type StoredState = {
  version: number;
  savedAt: number;
  profile: {
    language: Language | null;
    gender: Gender | null;
    ageBand: number;
    ageConfirmed: boolean;
    allergyIds: string[];
    conditionIds: string[];
    healthNotes: HealthNote[];
  };
  chatTurns: ChatTurn[];
};

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function sanitizeHealthNotes(value: unknown): HealthNote[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (item): item is HealthNote =>
        Boolean(item) &&
        typeof item === "object" &&
        typeof (item as HealthNote).text === "string" &&
        (item as HealthNote).text.trim().length > 0,
    )
    .slice(-MAX_HEALTH_NOTES);
}

function sanitizeChatTurns(value: unknown): ChatTurn[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (item): item is ChatTurn =>
        Boolean(item) &&
        typeof item === "object" &&
        typeof (item as ChatTurn).id === "string" &&
        typeof (item as ChatTurn).answer === "string" &&
        Array.isArray((item as ChatTurn).pages),
    )
    .map((turn) => ({
      id: turn.id,
      question: typeof turn.question === "string" ? turn.question : "",
      answer: turn.answer,
      pages: stringArray(turn.pages),
      attachmentLabels: stringArray(turn.attachmentLabels),
      riskLevel: (turn.riskLevel === "danger" || turn.riskLevel === "caution"
        ? turn.riskLevel
        : "safe") as ChatTurn["riskLevel"],
      warningMessage:
        typeof turn.warningMessage === "string" ? turn.warningMessage : "",
    }))
    .filter((turn) => turn.pages.length > 0)
    .slice(-MAX_STORED_TURNS);
}

/** 저장 파일이나 저장소에서 읽은 값이 깨져 있어도 화면이 죽지 않게 걸러 낸다. */
function sanitizeStoredState(value: unknown): StoredState | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<StoredState>;
  const profile = (raw.profile ?? {}) as Partial<StoredState["profile"]>;
  const languageValid = languages.some((item) => item.id === profile.language);
  const ageBand =
    typeof profile.ageBand === "number" && ageChoices.includes(profile.ageBand)
      ? profile.ageBand
      : 70;

  return {
    version: 1,
    savedAt: typeof raw.savedAt === "number" ? raw.savedAt : Date.now(),
    profile: {
      language: languageValid ? (profile.language as Language) : null,
      gender:
        profile.gender === "male" || profile.gender === "female"
          ? profile.gender
          : null,
      ageBand,
      ageConfirmed: profile.ageConfirmed === true,
      allergyIds: stringArray(profile.allergyIds),
      conditionIds: stringArray(profile.conditionIds),
      healthNotes: sanitizeHealthNotes(profile.healthNotes),
    },
    chatTurns: sanitizeChatTurns(raw.chatTurns),
  };
}

/** v1 이전에 localStorage에만 있던 음성 메모를 읽어 온다. */
function readLegacyHealthNotes(): HealthNote[] {
  try {
    const raw = window.localStorage.getItem(HEALTH_NOTES_STORAGE_KEY);
    return raw ? sanitizeHealthNotes(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}
/** 메모는 프롬프트에 그대로 들어가므로 최근 것만 유지한다. */
const MAX_HEALTH_NOTES = 8;
const TTS_CACHE_NAME = "silverlens-tts-v1";

const promptCopy: Record<Language, Record<SetupStep, string>> = {
  "ko-KR": {
    language: "사용할 언어를 선택해 주세요.",
    gender: "성별을 선택해 주세요.",
    age: "해당하는 나이대 버튼을 눌러 주세요.",
    complete: "기본 설정이 끝났습니다. 알레르기와 질병 정보는 선택해서 추가할 수 있어요.",
  },
  "en-US": {
    language: "Please choose your language.",
    gender: "Please choose your gender.",
    age: "Please tap the button for your age group.",
    complete: "Basic setup is complete. You may add allergy and health information.",
  },
  "ja-JP": {
    language: "使用する言語を選んでください。",
    gender: "性別を選んでください。",
    age: "該当する年齢層のボタンを押してください。",
    complete: "基本設定が完了しました。アレルギーや病気の情報も追加できます。",
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
  "ja-JP": {
    audioAttached: "音声を追加しました。必要なら写真や文字も足して、「質問を送る」を押してください。",
    photoAttached: "写真を追加しました。必要なら音声や文字も足して、「質問を送る」を押してください。",
  },
};

/**
 * 촬영 목적 3분기. 어르신이 사진으로 물어보는 상황은 실제로 이 셋으로 나뉜다.
 * 목적을 고르면 곧바로 카메라가 열리므로 버튼 하나만 더 누르는 셈이다.
 */
const photoPurposeOptions: Array<{
  id: PhotoPurpose;
  icon: string;
  labelKey: "photoPurposeLabel" | "photoPurposeFood" | "photoPurposeMedicine";
  tipKey: "photoPurposeLabelTip" | "photoPurposeFoodTip" | "photoPurposeMedicineTip";
}> = [
  {
    id: "label",
    icon: "🏷️",
    labelKey: "photoPurposeLabel",
    tipKey: "photoPurposeLabelTip",
  },
  {
    id: "food",
    icon: "🍚",
    labelKey: "photoPurposeFood",
    tipKey: "photoPurposeFoodTip",
  },
  {
    id: "medicine",
    icon: "💊",
    labelKey: "photoPurposeMedicine",
    tipKey: "photoPurposeMedicineTip",
  },
];

const uiCopy = {
  "ko-KR": {
    menuLabel: "서비스 메뉴",
    brand: "실버렌즈",
    service: "서비스",
    about: "서비스 소개",
    sidebarTitle: "어르신을 위한 AI",
    sidebarNote: "말하고, 찍고, 편하게 물어보세요.",
    progressLanguage: "언어",
    progressGender: "성별",
    progressAge: "나이",
    next: "다음",
    autoVoice: "자동 음성 안내",
    on: "켜짐",
    off: "꺼짐",
    autoVoiceHelpOn: "누르면 자동 재생이 꺼집니다.",
    autoVoiceHelpOff: "누르면 자동 재생이 켜집니다.",
    answerSpeed: "답변 속도",
    answerSpeedHelp: "손이나 마우스로 끌어 음성 답변 속도를 조절하세요.",
    answerSpeedPreview: "🔈 이 속도로 들어보기",
    answerSpeedSample: "지금 이 속도로 답변을 읽어드릴게요.",
    answerSpeedLimited: "이 브라우저는 한국어 음성 속도 조절이 제한돼요. 끊어 읽기로 속도를 맞춥니다.",
    ageOver: "{age}세 이상",
    ageUnder: "{age}세 이하",
    writeText: "글로 쓰기",
    riskDanger: "위험",
    riskCaution: "주의",
    languageLegend: "언어",
    genderLegend: "성별",
    male: "남자",
    female: "여자",
    ageLegend: "나이",
    years: "대",
    ageHelp: "해당하는 나이대 버튼을 눌러 주세요. 다시 누르면 선택이 취소됩니다.",
    allergyTitle: "알레르기 정보",
    allergyHelp: "먹으면 불편한 음식",
    conditionTitle: "질병 정보",
    conditionHelp: "현재 치료 중인 질환",
    noneOption: "해당없음",
    directInput: "+ 직접 입력",
    directInputClose: "− 목록 닫기",
    pickerHint: "묶음 제목을 누르면 항목이 펼쳐집니다.",
    clearSelection: "선택 모두 지우기",
    selectedSummary: "{count}개 선택",
    voiceInput: "🎙 말해서 입력",
    recordingDone: "■ 녹음 완료",
    inputPlaceholder: "입력 후 엔터",
    healthLanguageNote: "등록한 건강 정보는 선택한 언어에 맞춰 표시됩니다.",
    notesTitle: "음성으로 남긴 상세 메모",
    notesHelp: "말씀하신 내용을 그대로 저장해 AI가 답변할 때 함께 참고합니다.",
    notesEmpty: "아직 저장된 메모가 없어요. 말해서 입력을 누르고 자세히 말씀해 주세요.",
    notesExample: "예: 견과류 중에 특히 호두가 안 맞아요.",
    noteRemove: "메모 지우기",
    noteSaved: "말씀하신 내용을 상세 메모로 저장했어요.",
    noteKindAllergy: "알레르기",
    noteKindCondition: "질병",
    noteKindSetup: "건강정보",
    quotaExceeded: "AI 무료 사용 한도에 도달했어요. 잠시 뒤에 다시 질문해 주세요.",
    quotaWait: "AI 무료 사용 한도에 도달했어요. {seconds}초 뒤에 다시 질문해 주세요.",
    voiceProfile: "건강정보 한 번에 말하기",
    voiceProfileHelp: "알레르기와 질병을 함께 말해요.",
    replayGuide: "안내 다시 듣기",
    replayGuideHelp: "현재 단계부터 안내",
    savedRecording: "음성이 저장되었습니다.",
    transcript: "음성 인식 결과",
    start: "설정 완료하고 대화 시작",
    completionHint: "언어·성별·나이대를 선택하면 대화를 시작할 수 있어요.",
    backToSetup: "← 설정으로",
    welcomeVoice:
      "안녕하세요. 무엇이든 편하게 말씀해 주세요. 드시려는 음식 이름을 말하시거나 사진을 찍어 보여주시면 드셔도 괜찮은지 알려드립니다. 알레르기나 앓고 계신 병이 있으시면 내 정보 입력하기 버튼을 눌러 알려주세요.",
    welcomeTitle: "말씀만 하시면 됩니다",
    welcomeBody:
      "드시려는 음식 이름을 말하거나 사진을 찍어 보여주세요. 드셔도 괜찮은지 큰 글자로 알려드립니다.",
    welcomeReplay: "🔊 안내 다시 듣기",
    openProfile: "내 정보 입력하기",
    openProfileHelp: "알레르기·질병을 알려주면 더 정확해요",
    profileDone: "입력 완료, 대화로 돌아가기",
    waitTranscribing: "건강정보를 입력하고 있어요. 잠시만 기다려 주세요.",
    quickProfileTitle: "먼저 알려주시면 더 정확해요",
    quickProfileHelp: "말씀하시거나 아래 버튼을 눌러 주세요. 넘어가도 대화는 됩니다.",
    quickProfileSpeak: "내 정보 말하기",
    quickProfileSpeakHelp: "예: 나이는 일흔이고 복숭아 알레르기가 있어요",
    quickProfileMore: "알레르기 · 질병까지 자세히 입력하기",
    quickProfileDone: "알려주신 정보로 답변합니다",
    backupTitle: "내 정보 저장",
    backupHelp: "이 기기에만 저장됩니다. 로그인은 필요하지 않아요.",
    backupSavedAt: "{time}에 저장했어요.",
    backupNever: "아직 저장된 내용이 없어요.",
    backupStoreLocal: "이 브라우저의 저장 공간이 제한되어 간단히 저장합니다.",
    backupStoreNone: "이 브라우저에서는 저장할 수 없어요.",
    backupExport: "저장 파일 내보내기",
    backupImport: "저장 파일 불러오기",
    backupClear: "저장한 내용 지우기",
    backupExportDone: "저장 파일을 내려받았어요. 기기를 바꿀 때 이 파일을 불러오세요.",
    backupImportDone: "저장 파일을 불러왔어요.",
    backupImportFail: "저장 파일을 읽지 못했어요. 다른 파일을 골라 주세요.",
    backupClearConfirm: "저장한 정보와 대화를 모두 지울까요?",
    backupCleared: "저장한 내용을 지웠어요.",
    profileAge: "대 맞춤",
    headline: "오늘은 무엇을 도와드릴까요?",
    answerLabel: "AI 답변",
    answerLoading: "답변 만드는 중",
    answerWaiting: "답변 대기 중",
    conversation: "대화",
    answer: "답변",
    prevAnswer: "이전 대화 또는 이전 답변",
    nextAnswer: "다음 답변 또는 새 대화",
    questionBadge: "질문",
    foodWarning: "음식 경고",
    foodCheck: "먹기 전 확인",
    attachmentLabel: "함께 보낸 첨부",
    quickAskTitle: "이런 것도 물어보실 수 있어요",
    emptyAnswerTitle: "질문을 보내면 답변을 큰 글자로 보여드려요.",
    emptyAnswerHelp: "답변이 길면 오른쪽 카드로 이어지고, 왼쪽으로 넘기면 이전 답변을 다시 볼 수 있어요.",
    previousCards: "← 이전 답변",
    nextCards: "이어지는 답변 →",
    pageBadge: "{total}장 중 {current}장",
    nextPagePrompt: "다음 장에 내용이 이어집니다",
    lastPageNotice: "이 답변은 여기까지입니다.",
    cardSelector: "답변 카드 선택",
    stopReplay: "■ 답변 재생 멈추기",
    preparingReplay: "🔊 음성 준비 중 · 준비되면 바로 재생",
    readyReplay: "🔊 답변 다시 듣기 · 즉시 재생",
    replayAnswer: "🔊 현재 답변 다시 듣기",
    questionArea: "질문 작성",
    textQuestion: "글자로 질문하기",
    questionPlaceholder: "예: 닭고기를 많이 먹어도 괜찮나요?",
    pendingTitle: "함께 보낼 내용",
    audioAttached: "음성 첨부",
    photoAttached: "사진 첨부",
    sendPendingHelp: "아직 전송하지 않았어요. 질문 보내기를 누르면 한꺼번에 올라가요.",
    voiceRecord: "음성 녹음",
    recording: "녹음 중",
    recordingHelp: "다시 누르면 첨부",
    voiceRecordHelp: "녹음만으로도 전송할 수 있어요.",
    uploadPhoto: "사진 올리기",
    uploadPhotoHelp: "음성과 함께 보낼 수 있어요.",
    sendQuestion: "질문 보내기",
    sendingQuestion: "서버에 보내는 중",
    sendHelp: "글·음성·사진을 함께 전송",
    medicalNote: "이 내용은 일반 생활 참고용이며 진단·치료를 대신하지 않습니다. 처방받은 식단이 있으면 그 안내를 우선하세요.",
    processingVoice: "음성을 글자로 바꾸고 있어요. 잠시만 기다려 주세요.",
    profileVoiceFound: "AI가 음성을 확인해 알레르기 {allergies}개, 질병 {conditions}개를 나누어 입력했어요.",
    profileVoiceEmpty: "음성에서 분명하게 말한 알레르기나 질병 정보를 찾지 못했어요.",
    voiceFoundGender: "말씀하신 성별도 함께 골라 두었어요.",
    voiceFoundAge: "말씀하신 나이에 맞춰 {age}대를 골라 두었어요.",
    audioPreviewFail: "음성은 첨부됐지만 글자로 미리보지 못했습니다. 음성 자체는 함께 보낼 수 있어요.",
    transcribeRetry: "음성을 글자로 바꾸지 못했습니다. 다시 말해 주세요.",
    micPermission: "마이크 권한을 허용하면 음성으로 말할 수 있어요.",
    imageOnly: "사진 파일만 첨부할 수 있어요.",
    imageTooLarge: "사진은 8MB 이하로 선택해 주세요.",
    requireInput: "글, 음성, 사진 중 하나 이상을 준비해 주세요.",
    audioLabel: "음성",
    photoOneLabel: "사진 1장",
    audioPhotoQuestion: "음성과 사진으로 질문",
    audioQuestion: "음성으로 질문",
    photoQuestion: "사진으로 질문",
    photoPurposeTitle: "무엇을 찍으실 건가요?",
    photoPurposeHelp: "고르시면 잘 찍는 방법을 알려 드리고 바로 카메라가 열려요.",
    photoPurposeCancel: "그만두기",
    photoPurposeLabel: "성분표·라벨",
    photoPurposeLabelTip: "글자가 화면을 가득 채우게, 봉지를 펴서 찍어 주세요.",
    photoPurposeFood: "음식·식재료",
    photoPurposeFoodTip: "음식 전체가 들어오게, 위에서 내려다보며 찍어 주세요.",
    photoPurposeMedicine: "약 봉투·약 이름",
    photoPurposeMedicineTip: "약 이름과 하루 몇 번 먹는지가 보이게 찍어 주세요.",
    photoPreparing: "사진을 확인하고 있어요.",
    photoReviewTitle: "사진을 확인해 주세요",
    photoReviewHelp: "글자가 읽히면 그대로 물어보시고, 아니면 다시 찍어 주세요.",
    photoRetake: "다시 찍기",
    photoUseIt: "이대로 물어보기",
    photoZoomOpen: "크게 보기",
    photoZoomClose: "닫기",
    photoQualityOk: "잘 찍혔어요. 그대로 물어보셔도 돼요.",
    photoQualityDark: "사진이 어두워요. 불을 켜거나 창가에서 다시 찍어 보세요.",
    photoQualityBright: "빛이 너무 세서 글자가 날아갔어요. 그림자를 피해 다시 찍어 보세요.",
    photoQualityBlurry: "사진이 흐릿해요. 손을 어딘가에 받치고 다시 찍어 보세요.",
    photoQualitySkipped: "사진 상태는 확인하지 못했어요. 글자가 읽히는지 직접 봐 주세요.",
    photoSizeNote: "보낼 사진 크기",
  },
  "en-US": {
    menuLabel: "Service menu",
    brand: "SilverLens",
    service: "Service",
    about: "About",
    sidebarTitle: "AI for older adults",
    sidebarNote: "Speak, snap a photo, and ask comfortably.",
    progressLanguage: "Language",
    progressGender: "Gender",
    progressAge: "Age",
    next: "Next",
    autoVoice: "Automatic voice guide",
    on: "On",
    off: "Off",
    autoVoiceHelpOn: "Tap to turn automatic playback off.",
    autoVoiceHelpOff: "Tap to turn automatic playback on.",
    answerSpeed: "Answer speed",
    answerSpeedHelp: "Drag with your hand or mouse to adjust voice answer speed.",
    answerSpeedPreview: "🔈 Hear this speed",
    answerSpeedSample: "I will read answers at this speed.",
    answerSpeedLimited: "This browser limits voice speed control, so pauses are used instead.",
    ageOver: "{age} and above",
    ageUnder: "{age} and under",
    writeText: "Write text",
    riskDanger: "Danger",
    riskCaution: "Caution",
    languageLegend: "Language",
    genderLegend: "Gender",
    male: "Male",
    female: "Female",
    ageLegend: "Age",
    years: "s",
    ageHelp: "Tap the button for your age group. Tap again to clear it.",
    allergyTitle: "Allergies",
    allergyHelp: "Foods that make you uncomfortable",
    conditionTitle: "Health conditions",
    conditionHelp: "Conditions currently being treated",
    noneOption: "None",
    directInput: "+ Type directly",
    directInputClose: "− Close the list",
    pickerHint: "Tap a group title to open its items.",
    clearSelection: "Clear all selections",
    selectedSummary: "{count} selected",
    voiceInput: "🎙 Speak to enter",
    recordingDone: "■ Finish recording",
    inputPlaceholder: "Type and press Enter",
    healthLanguageNote: "Registered health information is shown in the selected language.",
    notesTitle: "Spoken details",
    notesHelp: "We keep what you said and share it with the AI when it answers.",
    notesEmpty: "No details saved yet. Press Speak to enter and tell us more.",
    notesExample: "Example: Among nuts, walnuts are the real problem for me.",
    noteRemove: "Remove note",
    noteSaved: "Saved what you said as a detail note.",
    noteKindAllergy: "Allergy",
    noteKindCondition: "Condition",
    noteKindSetup: "Health info",
    quotaExceeded: "The free AI usage limit has been reached. Please ask again in a moment.",
    quotaWait: "The free AI usage limit has been reached. Please ask again in {seconds} seconds.",
    voiceProfile: "Say health info at once",
    voiceProfileHelp: "Say allergies and conditions together.",
    replayGuide: "Replay guide",
    replayGuideHelp: "Hear the current step again",
    savedRecording: "Your voice recording is saved.",
    transcript: "Voice recognition result",
    start: "Finish setup and start chat",
    completionHint: "Choose language, gender, and age to start chatting.",
    backToSetup: "← Back to setup",
    welcomeVoice:
      "Hello. Just say whatever you like. Tell me the name of a food or show me a photo, and I will tell you whether it is fine to eat. If you have allergies or a condition, press the My information button to let me know.",
    welcomeTitle: "Just speak to me",
    welcomeBody:
      "Say the name of a food or show me a photo. I will tell you in large text whether it is fine to eat.",
    welcomeReplay: "🔊 Play the guide again",
    openProfile: "My information",
    openProfileHelp: "Allergies and conditions make answers more precise",
    profileDone: "Done, back to the conversation",
    waitTranscribing: "I'm saving your health information. One moment please.",
    quickProfileTitle: "Tell me a little and answers get sharper",
    quickProfileHelp: "Speak it or tap the buttons below. You can skip this and still chat.",
    quickProfileSpeak: "Say my details",
    quickProfileSpeakHelp: "Example: I'm in my seventies and allergic to peaches",
    quickProfileMore: "Add allergies and conditions in detail",
    quickProfileDone: "I'll answer using what you shared",
    backupTitle: "Saved on this device",
    backupHelp: "Everything stays on this device. No sign-in needed.",
    backupSavedAt: "Saved at {time}.",
    backupNever: "Nothing saved yet.",
    backupStoreLocal: "This browser limits storage, so we save a simpler copy.",
    backupStoreNone: "This browser cannot save anything.",
    backupExport: "Export a backup file",
    backupImport: "Load a backup file",
    backupClear: "Delete saved data",
    backupExportDone: "Backup file downloaded. Load it when you change devices.",
    backupImportDone: "Backup file loaded.",
    backupImportFail: "Could not read that file. Please choose another one.",
    backupClearConfirm: "Delete all saved information and conversations?",
    backupCleared: "Saved data deleted.",
    profileAge: "s profile",
    headline: "How can I help today?",
    answerLabel: "AI Answer",
    answerLoading: "Creating answer",
    answerWaiting: "Waiting for answer",
    conversation: "Conversation",
    answer: "Answer",
    prevAnswer: "Previous conversation or answer",
    nextAnswer: "Next answer or new conversation",
    questionBadge: "Question",
    foodWarning: "Food warning",
    foodCheck: "Check before eating",
    attachmentLabel: "Sent attachments",
    quickAskTitle: "You can also ask things like these",
    emptyAnswerTitle: "Send a question and I’ll show the answer in large text.",
    emptyAnswerHelp: "Long answers continue on the next card. Swipe left to revisit previous answers.",
    previousCards: "← Previous answers",
    nextCards: "More answers →",
    pageBadge: "Page {current} of {total}",
    nextPagePrompt: "The answer continues on the next page",
    lastPageNotice: "That is the end of this answer.",
    cardSelector: "Choose answer card",
    stopReplay: "■ Stop answer playback",
    preparingReplay: "🔊 Voice preparing · plays when ready",
    readyReplay: "🔊 Replay answer · play now",
    replayAnswer: "🔊 Replay current answer",
    questionArea: "Write a question",
    textQuestion: "Ask with text",
    questionPlaceholder: "Example: Is it okay to eat a lot of chicken?",
    pendingTitle: "Ready to send",
    audioAttached: "Voice attached",
    photoAttached: "Photo attached",
    sendPendingHelp: "Not sent yet. Press Send question to upload everything together.",
    voiceRecord: "Voice recording",
    recording: "Recording",
    recordingHelp: "Tap again to attach",
    voiceRecordHelp: "You can send with only a recording.",
    uploadPhoto: "Upload photo",
    uploadPhotoHelp: "You can send it with voice.",
    sendQuestion: "Send question",
    sendingQuestion: "Sending to server",
    sendHelp: "Send text, voice, and photo together",
    medicalNote: "This is general lifestyle information and does not replace diagnosis or treatment. If you have a prescribed diet, follow that guidance first.",
    processingVoice: "Converting your voice to text. Please wait a moment.",
    profileVoiceFound: "AI found {allergies} allergies and {conditions} conditions from your voice and added them separately.",
    profileVoiceEmpty: "I could not find clearly spoken allergy or condition information in the voice.",
    voiceFoundGender: "I also selected the gender you mentioned.",
    voiceFoundAge: "I selected the {age}s to match the age you mentioned.",
    audioPreviewFail: "The recording is attached, but I could not preview it as text. The audio can still be sent.",
    transcribeRetry: "I could not convert the voice to text. Please try again.",
    micPermission: "Allow microphone permission to speak by voice.",
    imageOnly: "Please attach an image file only.",
    imageTooLarge: "Please choose a photo under 8 MB.",
    requireInput: "Please prepare text, voice, or a photo before sending.",
    audioLabel: "Voice",
    photoOneLabel: "1 photo",
    audioPhotoQuestion: "Question with voice and photo",
    audioQuestion: "Question with voice",
    photoQuestion: "Question with photo",
    photoPurposeTitle: "What are you taking a photo of?",
    photoPurposeHelp: "Pick one and we will share a tip, then open the camera.",
    photoPurposeCancel: "Cancel",
    photoPurposeLabel: "Ingredient list or label",
    photoPurposeLabelTip: "Flatten the package and fill the screen with the text.",
    photoPurposeFood: "Food or ingredient",
    photoPurposeFoodTip: "Look down from above so the whole dish fits in.",
    photoPurposeMedicine: "Medicine packet or name",
    photoPurposeMedicineTip: "Make sure the medicine name and daily doses are visible.",
    photoPreparing: "Checking the photo.",
    photoReviewTitle: "Please check the photo",
    photoReviewHelp: "If you can read the text, go ahead and ask. If not, take it again.",
    photoRetake: "Take again",
    photoUseIt: "Ask with this photo",
    photoZoomOpen: "View larger",
    photoZoomClose: "Close",
    photoQualityOk: "Looks good. You can ask with this photo.",
    photoQualityDark: "The photo is dark. Turn on a light or move near a window.",
    photoQualityBright: "Too much glare washed out the text. Avoid direct light and retake.",
    photoQualityBlurry: "The photo is blurry. Rest your hand on something and retake.",
    photoQualitySkipped: "We could not check this photo. Please confirm the text is readable.",
    photoSizeNote: "Photo size to send",
  },
  "ja-JP": {
    menuLabel: "サービスメニュー",
    brand: "シルバーレンズ",
    service: "サービス",
    about: "サービス紹介",
    sidebarTitle: "高齢者のためのAI",
    sidebarNote: "話して、撮って、気軽に聞いてください。",
    progressLanguage: "言語",
    progressGender: "性別",
    progressAge: "年齢",
    next: "次",
    autoVoice: "自動音声案内",
    on: "オン",
    off: "オフ",
    autoVoiceHelpOn: "押すと自動再生をオフにします。",
    autoVoiceHelpOff: "押すと自動再生をオンにします。",
    answerSpeed: "回答速度",
    answerSpeedHelp: "指やマウスで動かして音声回答の速さを調整してください。",
    answerSpeedPreview: "🔈 この速さで聞く",
    answerSpeedSample: "この速さで回答をお読みします。",
    answerSpeedLimited: "このブラウザは音声速度の調整が制限されるため、区切り読みで調整します。",
    ageOver: "{age}歳以上",
    ageUnder: "{age}歳以下",
    writeText: "文字で書く",
    riskDanger: "危険",
    riskCaution: "注意",
    languageLegend: "言語",
    genderLegend: "性別",
    male: "男性",
    female: "女性",
    ageLegend: "年齢",
    years: "代",
    ageHelp: "該当する年齢層のボタンを押してください。もう一度押すと選択が解除されます。",
    allergyTitle: "アレルギー情報",
    allergyHelp: "食べると不調になる食品",
    conditionTitle: "病気の情報",
    conditionHelp: "現在治療中の病気",
    noneOption: "該当なし",
    directInput: "+ 直接入力",
    directInputClose: "− 一覧を閉じる",
    pickerHint: "グループの見出しを押すと項目が開きます。",
    clearSelection: "選択をすべて消す",
    selectedSummary: "{count}件 選択",
    voiceInput: "🎙 話して入力",
    recordingDone: "■ 録音完了",
    inputPlaceholder: "入力後 Enter",
    healthLanguageNote: "登録した健康情報は選択した言語で表示されます。",
    notesTitle: "話して残した詳しいメモ",
    notesHelp: "話した内容をそのまま保存し、AIが答えるときに一緒に参考にします。",
    notesEmpty: "まだメモがありません。「話して入力」を押して詳しく話してください。",
    notesExample: "例: ナッツの中でも特にクルミが合いません。",
    noteRemove: "メモを消す",
    noteSaved: "話した内容を詳しいメモとして保存しました。",
    noteKindAllergy: "アレルギー",
    noteKindCondition: "病気",
    noteKindSetup: "健康情報",
    quotaExceeded: "AIの無料利用上限に達しました。少し待ってからもう一度質問してください。",
    quotaWait: "AIの無料利用上限に達しました。{seconds}秒後にもう一度質問してください。",
    voiceProfile: "健康情報をまとめて話す",
    voiceProfileHelp: "アレルギーと病気を一緒に話せます。",
    replayGuide: "案内をもう一度聞く",
    replayGuideHelp: "現在の手順から案内",
    savedRecording: "音声が保存されました。",
    transcript: "音声認識結果",
    start: "設定を完了して会話を始める",
    completionHint: "言語・性別・年齢を選ぶと会話を始められます。",
    backToSetup: "← 設定へ戻る",
    welcomeVoice:
      "こんにちは。何でも気軽に話してください。食べたい食品の名前を言うか、写真を撮って見せてくださると、食べても大丈夫かお知らせします。アレルギーやご病気があれば、「私の情報を入力」ボタンを押して教えてください。",
    welcomeTitle: "話すだけで大丈夫です",
    welcomeBody:
      "食べたい食品の名前を言うか、写真を撮って見せてください。食べても大丈夫か大きな文字でお知らせします。",
    welcomeReplay: "🔊 案内をもう一度聞く",
    openProfile: "私の情報を入力",
    openProfileHelp: "アレルギーや病気を教えるとより正確です",
    profileDone: "入力完了、会話に戻る",
    waitTranscribing: "健康情報を保存しています。少しお待ちください。",
    quickProfileTitle: "先に教えていただくとより正確です",
    quickProfileHelp: "お話しになるか、下のボタンを押してください。飛ばしても会話できます。",
    quickProfileSpeak: "自分の情報を話す",
    quickProfileSpeakHelp: "例：年齢は七十で、桃のアレルギーがあります",
    quickProfileMore: "アレルギー・病気まで詳しく入力する",
    quickProfileDone: "教えていただいた情報でお答えします",
    backupTitle: "この端末に保存",
    backupHelp: "この端末だけに保存されます。ログインは不要です。",
    backupSavedAt: "{time}に保存しました。",
    backupNever: "まだ保存された内容がありません。",
    backupStoreLocal: "このブラウザは保存領域が限られるため簡易保存します。",
    backupStoreNone: "このブラウザでは保存できません。",
    backupExport: "バックアップを書き出す",
    backupImport: "バックアップを読み込む",
    backupClear: "保存した内容を消す",
    backupExportDone: "バックアップを保存しました。端末を変えるときに読み込んでください。",
    backupImportDone: "バックアップを読み込みました。",
    backupImportFail: "ファイルを読めませんでした。別のファイルを選んでください。",
    backupClearConfirm: "保存した情報と会話をすべて消しますか？",
    backupCleared: "保存した内容を消しました。",
    profileAge: "代向け",
    headline: "今日は何をお手伝いしましょうか？",
    answerLabel: "AI回答",
    answerLoading: "回答を作成中",
    answerWaiting: "回答待ち",
    conversation: "会話",
    answer: "回答",
    prevAnswer: "前の会話または回答",
    nextAnswer: "次の回答または新しい会話",
    questionBadge: "質問",
    foodWarning: "食品の警告",
    foodCheck: "食べる前に確認",
    attachmentLabel: "一緒に送った添付",
    quickAskTitle: "こんなことも聞けます",
    emptyAnswerTitle: "質問を送ると、回答を大きな文字で表示します。",
    emptyAnswerHelp: "回答が長い場合は次のカードに続きます。左へ戻ると前の回答を見られます。",
    previousCards: "← 前の回答",
    nextCards: "続きの回答 →",
    pageBadge: "全{total}枚中 {current}枚目",
    nextPagePrompt: "次のページに続きがあります",
    lastPageNotice: "この回答はここまでです。",
    cardSelector: "回答カードを選択",
    stopReplay: "■ 回答再生を止める",
    preparingReplay: "🔊 音声準備中 · 準備後すぐ再生",
    readyReplay: "🔊 回答をもう一度聞く · すぐ再生",
    replayAnswer: "🔊 現在の回答をもう一度聞く",
    questionArea: "質問作成",
    textQuestion: "文字で質問する",
    questionPlaceholder: "例：鶏肉をたくさん食べても大丈夫ですか？",
    pendingTitle: "一緒に送る内容",
    audioAttached: "音声添付",
    photoAttached: "写真添付",
    sendPendingHelp: "まだ送信していません。「質問を送る」を押すとまとめて送れます。",
    voiceRecord: "音声録音",
    recording: "録音中",
    recordingHelp: "もう一度押すと添付",
    voiceRecordHelp: "録音だけでも送れます。",
    uploadPhoto: "写真を追加",
    uploadPhotoHelp: "音声と一緒に送れます。",
    sendQuestion: "質問を送る",
    sendingQuestion: "送信中",
    sendHelp: "文字・音声・写真を一緒に送信",
    medicalNote: "この内容は一般的な生活参考情報であり、診断や治療の代わりではありません。処方された食事指導がある場合はそちらを優先してください。",
    processingVoice: "音声を文字に変換しています。少しお待ちください。",
    profileVoiceFound: "AIが音声を確認し、アレルギー{allergies}件、病気{conditions}件を分けて入力しました。",
    profileVoiceEmpty: "音声から明確なアレルギーや病気の情報を見つけられませんでした。",
    voiceFoundGender: "お話しになった性別も一緒に選んでおきました。",
    voiceFoundAge: "お話しになった年齢に合わせて{age}代を選んでおきました。",
    audioPreviewFail: "音声は添付されましたが、文字プレビューはできませんでした。音声自体は一緒に送れます。",
    transcribeRetry: "音声を文字に変換できませんでした。もう一度話してください。",
    micPermission: "マイクの許可をすると、音声で話せます。",
    imageOnly: "写真ファイルだけを添付できます。",
    imageTooLarge: "写真は8MB以下で選んでください。",
    requireInput: "文字、音声、写真のいずれかを用意してください。",
    audioLabel: "音声",
    photoOneLabel: "写真1枚",
    audioPhotoQuestion: "音声と写真で質問",
    audioQuestion: "音声で質問",
    photoQuestion: "写真で質問",
    photoPurposeTitle: "何を撮りますか？",
    photoPurposeHelp: "選ぶと上手に撮るコツをお伝えして、すぐカメラが開きます。",
    photoPurposeCancel: "やめる",
    photoPurposeLabel: "成分表・ラベル",
    photoPurposeLabelTip: "袋を平らに伸ばし、文字が画面いっぱいになるように撮ってください。",
    photoPurposeFood: "料理・食材",
    photoPurposeFoodTip: "真上から見下ろして、料理全体が入るように撮ってください。",
    photoPurposeMedicine: "薬の袋・薬の名前",
    photoPurposeMedicineTip: "薬の名前と一日何回飲むかが見えるように撮ってください。",
    photoPreparing: "写真を確認しています。",
    photoReviewTitle: "写真を確認してください",
    photoReviewHelp: "文字が読めればそのまま質問し、読めなければ撮り直してください。",
    photoRetake: "撮り直す",
    photoUseIt: "この写真で質問する",
    photoZoomOpen: "大きく見る",
    photoZoomClose: "閉じる",
    photoQualityOk: "きれいに撮れました。このまま質問できます。",
    photoQualityDark: "写真が暗いです。明かりをつけるか窓の近くで撮り直してください。",
    photoQualityBright: "光が強すぎて文字が飛んでいます。直射光を避けて撮り直してください。",
    photoQualityBlurry: "写真がぼやけています。手をどこかに固定して撮り直してください。",
    photoQualitySkipped: "写真の状態は確認できませんでした。文字が読めるかご自身で確認してください。",
    photoSizeNote: "送る写真の大きさ",
  },
} satisfies Record<Language, Record<string, string>>;

type AboutFeature = { title: string; text: string };
type AboutStep = { step: string; title: string; text: string };
/**
 * 소개 페이지의 "이렇게 쓰세요" 단계.
 * 사진을 올리는 대신 실제 화면을 흉내 낸 작은 목업을 CSS로 그린다.
 * 스크린샷을 쓰면 화면을 고칠 때마다 이미지가 낡고 용량도 늘어난다.
 */
type AboutGuideStep = {
  step: string;
  title: string;
  text: string;
  tips: string[];
  mockTitle: string;
  mockItems: string[];
  mockNote: string;
  /** 어두운 화면 아래에 흰 글씨로 얹는 한 문장 설명. */
  mockCaption: string;
  /** 손가락으로 가리켜 강조할 mockItems 번호. 강조가 없으면 -1. */
  mockHighlight: number;
};
const GITHUB_URL = "https://github.com/dohyunfinger/-OGQ-";

const teamMembers: Array<{ name: string; roles: Record<Language, string> }> = [
  {
    name: "박정찬",
    roles: { "ko-KR": "팀장", "en-US": "Team lead", "ja-JP": "チームリーダー" },
  },
  {
    name: "최수혁",
    roles: { "ko-KR": "백엔드", "en-US": "Backend", "ja-JP": "バックエンド" },
  },
  {
    name: "김근호",
    roles: { "ko-KR": "프론트엔드", "en-US": "Frontend", "ja-JP": "フロントエンド" },
  },
  {
    name: "이도현",
    roles: { "ko-KR": "깃허브 관리", "en-US": "Repository", "ja-JP": "リポジトリ管理" },
  },
];

type AboutCopy = {
  backToService: string;
  githubCta: string;
  teamTitle: string;
  navFeatures: string;
  navWorkflow: string;
  navGuide: string;
  languageLabel: string;
  heroSecondaryCta: string;
  brandSubtitle: string;
  heroTitle: string;
  heroTitleAccent: string;
  heroDescription: string[];
  heroCta: string;
  featuresBadge: string;
  featuresTitle: string;
  featuresTitleAccent: string;
  featuresDescription: string;
  features: AboutFeature[];
  workflowBadge: string;
  workflowTitle: string;
  workflowTitleAccent: string;
  workflowDescription: string;
  steps: AboutStep[];
  /** 어르신이 화면에서 무엇을 누르면 되는지 순서대로 보여 주는 사용 가이드. */
  guideBadge: string;
  guideTitle: string;
  guideTitleAccent: string;
  guideDescription: string;
  guideTipsLabel: string;
  guideSteps: AboutGuideStep[];
  guideCta: string;
  /** 실제 서비스 화면 조각을 소개 페이지 안에서 미리 보여 주는 블록. */
  previewBadge: string;
  previewTitle: string;
  previewDescription: string;
  previewRiskTitle: string;
  previewRiskSafe: string;
  previewDialectTitle: string;
  previewDialectFrom: string;
  previewDialectTo: string;
  previewAnswerTitle: string;
  previewAnswerText: string;
  previewMic: string;
  footer: string;
};

const aboutCopy: Record<Language, AboutCopy> = {
  "ko-KR": {
    backToService: "서비스로 돌아가기",
    githubCta: "깃허브 저장소 바로가기",
    teamTitle: "만든 사람들",
    navFeatures: "핵심 기능",
    navWorkflow: "이용 흐름",
    navGuide: "사용 방법",
    languageLabel: "언어 선택",
    heroSecondaryCta: "지금 시작하기",
    brandSubtitle: "디지털 세상의 소외를 지우는 빛, SilverLens",
    heroTitle: "사투리를 이해하는 AI,",
    heroTitleAccent: "시니어를 위한 건강 식생활",
    heroDescription: [
      "사투리를 이해하는 AI로 시니어에게 쉽고 안전한 건강 정보를 제공합니다.",
      "어려운 표현은 줄이고, 익숙한 말투로 더 편안한 디지털 건강 경험을 만듭니다.",
    ],
    heroCta: "핵심기술 보기",
    featuresBadge: "Core Features",
    featuresTitle: "누구나 쉽게 사용할 수 있도록,",
    featuresTitleAccent: "AI 기술은 보이지 않게 동작합니다",
    featuresDescription:
      "SilverLens는 시니어 사용자가 기술을 배우지 않아도 자연스럽게 쓸 수 있도록, 복잡한 AI 과정을 뒤로 숨기고 편안한 질문과 이해 중심의 경험만 남깁니다.",
    features: [
      {
        title: "사투리 이해 대화",
        text: "표준어 중심 서비스에서 소외되기 쉬운 지역 어르신도 익숙한 말투로 자연스럽게 질문할 수 있습니다.",
      },
      {
        title: "쉬운 문장 재구성",
        text: "어려운 의료·영양 정보를 짧고 편한 문장으로 바꿔 설명해 정보 이해의 장벽을 낮춥니다.",
      },
      {
        title: "안전 중심 정보 안내",
        text: "사용자의 불안을 키우지 않으면서 핵심을 명확히 전달하는 방식으로 건강 정보를 더 믿고 활용하게 돕습니다.",
      },
      {
        title: "빠른 정보 접근",
        text: "필요한 답을 바로 찾을 수 있도록 질문 흐름을 단순화해 시니어가 오래 헤매지 않도록 설계했습니다.",
      },
      {
        title: "단계별 식생활 가이드",
        text: "무엇을 먹어야 하는지, 어떻게 바꾸면 좋은지 일상 단위의 순서로 안내해 실생활에 연결합니다.",
      },
      {
        title: "익숙한 디지털 경험",
        text: "큰 제목, 넉넉한 여백, 단정한 카드 구조로 복잡함 없이 편안하게 읽을 수 있는 화면을 제공합니다.",
      },
    ],
    workflowBadge: "Workflow",
    workflowTitle: "질문에서 이해까지,",
    workflowTitleAccent: "한눈에 보이는 쉬운 정보 흐름",
    workflowDescription:
      "사용자는 어렵게 배우지 않아도 됩니다. SilverLens는 질문을 이해하고, 쉽게 풀어 설명하고, 생활 속 실천으로 이어지도록 단계별로 도와줍니다.",
    steps: [
      {
        step: "STEP 01",
        title: "질문하기",
        text: "사용자는 평소 쓰는 말투 그대로 건강이나 식생활에 대해 묻습니다. 표준어가 아니어도 자연스럽게 의도를 전달할 수 있습니다.",
      },
      {
        step: "STEP 02",
        title: "의도 이해",
        text: "AI가 사투리와 맥락을 해석해 사용자의 진짜 질문을 파악하고, 필요한 건강 정보의 방향을 정리합니다.",
      },
      {
        step: "STEP 03",
        title: "쉽게 설명",
        text: "복잡한 내용을 쉬운 단어와 짧은 문장으로 다시 풀어 설명해, 누구나 부담 없이 이해할 수 있는 정보로 바꿉니다.",
      },
      {
        step: "STEP 04",
        title: "실생활 적용",
        text: "이해한 정보를 바탕으로 일상 식단, 건강 습관, 생활 선택에 바로 적용할 수 있도록 행동 중심의 도움을 제공합니다.",
      },
    ],
    guideBadge: "How to use",
    guideTitle: "처음 오셨어도 괜찮습니다,",
    guideTitleAccent: "네 단계만 보시면 됩니다",
    guideDescription:
      "가입도, 로그인도 없습니다. 화면에 들어오면 바로 물어보실 수 있고, 아래 네 단계는 더 정확한 답을 받는 방법입니다. 건강 정보는 이 기기에만 저장되고 서버로 올라가지 않습니다.",
    guideTipsLabel: "이렇게 하시면 편합니다",
    guideSteps: [
      {
        step: "1단계",
        title: "언어와 성별, 나이를 고릅니다",
        text: "화면 위쪽 '내 정보 입력하기' 버튼을 누르면 나옵니다. 성별과 나이는 하루 권장 섭취량이 달라지는 부분에만 쓰이고, 넣지 않으셔도 대화는 그대로 됩니다.",
        tips: [
          "첫 화면의 '내 정보 말하기'를 누르고 말씀하시면 성별과 나이가 한 번에 채워집니다.",
          "첫 화면에 있는 성별·나이 버튼을 바로 눌러 고르셔도 됩니다.",
          "잘못 눌렀으면 같은 버튼을 한 번 더 눌러 취소합니다.",
          "언어를 바꾸면 등록해 둔 건강 정보 표기도 함께 바뀝니다.",
        ],
        mockTitle: "언어 · 성별 · 나이",
        // 국기 이모지는 Windows 에서 "KR" 같은 글자로 보여 목업에서는 쓰지 않는다.
        mockItems: ["한국어", "여자", "70대"],
        mockNote: "첫 화면에서 말하거나 눌러도 됩니다",
        mockCaption: "언어, 성별, 나이를 고르면 더 정확한 안내를 받으실 수 있습니다.",
        mockHighlight: 1,
      },
      {
        step: "2단계",
        title: "알레르기와 질병을 등록합니다",
        text: "여기까지 넣어 두시면 답변이 달라집니다. 등록한 알레르기 식품은 추천에서 빠지고, 질병에 걸리는 음식은 위험도를 한 단계 높여 알려 드립니다.",
        tips: [
          "묶음 제목을 누르면 항목이 펼쳐집니다. 해당 없으면 '해당없음'을 누르세요.",
          "목록에 없으면 '직접 입력'으로 적으실 수 있습니다.",
          "'말해서 입력'을 누르고 말씀하시면 그대로 메모로 남아 답변에 함께 반영됩니다.",
        ],
        mockTitle: "알레르기 · 질병",
        mockItems: ["우유", "견과류", "🎙 말해서 입력"],
        mockNote: "목록에서 골라도, 말로 해도 됩니다",
        mockCaption: "알레르기와 질병을 넣어 두시면 더 안전하게 안내합니다.",
        mockHighlight: 2,
      },
      {
        step: "3단계",
        title: "말하거나, 찍거나, 적어서 물어봅니다",
        text: "세 가지 중 편한 것을 쓰시면 됩니다. 사투리로 말씀하셔도 알아듣습니다. 음성과 사진을 함께 보내면 하나의 질문으로 이해합니다.",
        tips: [
          "음성은 큰 마이크 버튼을 누르고 말한 뒤 한 번 더 누르면 첨부됩니다.",
          "사진은 성분표·음식·약 봉투 중 무엇을 찍는지 먼저 고르면 찍는 방법을 알려 드립니다.",
          "찍은 사진이 어둡거나 흐리면 다시 찍으라고 알려 드립니다.",
        ],
        mockTitle: "물어보는 방법",
        mockItems: ["🎙 음성으로 말하기", "📷 사진 올리기", "⌨ 글로 쓰기"],
        mockNote: "자주 묻는 질문 버튼을 눌러도 됩니다",
        mockCaption: "말하거나, 사진을 올리거나, 직접 적으시면 됩니다.",
        mockHighlight: 1,
      },
      {
        step: "4단계",
        title: "답변을 한 장씩 넘겨 봅니다",
        text: "답변이 길면 여러 장으로 나눠 드립니다. 카드 위쪽에 '3장 중 1장'처럼 표시되고, 아래 '다음 장 보기' 버튼을 누르면 뒷장이 나옵니다.",
        tips: [
          "손가락으로 좌우로 밀어서 넘기실 수도 있습니다.",
          "마지막 장에는 '여기까지입니다'라고 적혀 있습니다.",
          "'답변 다시 듣기'를 누르면 소리로 읽어 드립니다.",
        ],
        mockTitle: "대화 1 · 답변 1/3",
        mockItems: ["무를 푹 끓이면 단맛이 살아나요. 설탕은 넣지 않으셔도 됩니다."],
        mockNote: "다음 장 보기 →",
        mockCaption: "큰 글씨 카드로 보여주고, 길면 다음 카드로 이어집니다.",
        mockHighlight: -1,
      },
    ],
    guideCta: "바로 시작해 보기",
    previewBadge: "Real UI",
    previewTitle: "서비스 화면은 이렇게 생겼습니다",
    previewDescription:
      "소개 화면은 넓게, 서비스 화면은 크게. 같은 딥그린 브랜드색을 쓰면서 어르신이 쓰는 화면만 글자와 버튼을 키우고 테두리를 두껍게 했습니다.",
    previewRiskTitle: "위험도 3중 표기",
    previewRiskSafe: "안전",
    previewDialectTitle: "사투리 표준어 변환",
    previewDialectFrom: "정구지",
    previewDialectTo: "부추",
    previewAnswerTitle: "큰 글자 답변 카드",
    previewAnswerText: "무를 푹 끓이면 단맛이 살아나요. 설탕은 넣지 않으셔도 됩니다.",
    previewMic: "🎙 눌러서 말하기",
    footer: "© SilverLens. 사투리를 이해하는 AI로 시니어의 건강 식생활 접근성을 높입니다.",
  },
  "en-US": {
    backToService: "Back to service",
    githubCta: "Open GitHub repository",
    teamTitle: "Team",
    navFeatures: "Core features",
    navWorkflow: "Workflow",
    navGuide: "How to use",
    languageLabel: "Choose language",
    heroSecondaryCta: "Start now",
    brandSubtitle: "SilverLens, the light that removes digital exclusion",
    heroTitle: "AI that understands dialects,",
    heroTitleAccent: "healthy eating for older adults",
    heroDescription: [
      "SilverLens delivers health information that is easy and safe for older adults.",
      "Fewer difficult terms, familiar phrasing, and a calmer digital health experience.",
    ],
    heroCta: "See core features",
    featuresBadge: "Core Features",
    featuresTitle: "Simple for everyone,",
    featuresTitleAccent: "with the AI working out of sight",
    featuresDescription:
      "SilverLens keeps the complex AI steps hidden so older adults can use the service without learning anything new, leaving only comfortable questions and clear understanding.",
    features: [
      {
        title: "Dialect-friendly conversation",
        text: "Older adults in any region can ask questions in their own words, even when standard-language services leave them out.",
      },
      {
        title: "Rewritten in plain words",
        text: "Difficult medical and nutrition details are rewritten into short, comfortable sentences that are easy to follow.",
      },
      {
        title: "Safety-first guidance",
        text: "Key points are stated clearly without raising anxiety, so health information feels trustworthy and usable.",
      },
      {
        title: "Fast access to answers",
        text: "The question flow stays simple so the answer arrives quickly and nobody gets lost along the way.",
      },
      {
        title: "Step-by-step food guide",
        text: "What to eat and what to change is explained in everyday order, connecting advice to real meals.",
      },
      {
        title: "Familiar digital experience",
        text: "Large headings, generous spacing, and tidy cards keep every screen calm and easy to read.",
      },
    ],
    workflowBadge: "Workflow",
    workflowTitle: "From question to understanding,",
    workflowTitleAccent: "one clear flow of information",
    workflowDescription:
      "Nothing new to learn. SilverLens understands the question, explains it simply, and carries it through to everyday practice, one step at a time.",
    steps: [
      {
        step: "STEP 01",
        title: "Ask",
        text: "Ask about health or food in your usual way of speaking. Standard language is never required to get the meaning across.",
      },
      {
        step: "STEP 02",
        title: "Understand intent",
        text: "The AI reads dialect and context together to find the real question and decide which health details matter.",
      },
      {
        step: "STEP 03",
        title: "Explain simply",
        text: "Complex content is rebuilt with simple words and short sentences so it can be understood without effort.",
      },
      {
        step: "STEP 04",
        title: "Apply it daily",
        text: "The answer turns into action for daily meals, health habits, and everyday choices.",
      },
    ],
    guideBadge: "How to use",
    guideTitle: "First time here is fine,",
    guideTitleAccent: "four steps are all it takes",
    guideDescription:
      "No sign-up, no login. You can ask a question the moment the screen opens, and these four steps simply help the answer fit you better. Health details stay on this device and are never uploaded to a server.",
    guideTipsLabel: "Handy to know",
    guideSteps: [
      {
        step: "Step 1",
        title: "Pick language, gender, and age",
        text: "Press the button at the top of the screen. Gender and age are used only where daily intake guidance differs, and you can keep chatting without entering them.",
        tips: [
          "Press Say my details on the first screen and speak, and gender and age fill in at once.",
          "You can also tap the gender and age buttons right on the first screen.",
          "Pressed the wrong one? Press the same button again to clear it.",
          "Changing the language also changes how saved health details are shown.",
        ],
        mockTitle: "Language · Gender · Age",
        mockItems: ["English", "Female", "70s"],
        mockNote: "Speak it or tap it on the first screen",
        mockCaption: "Choosing language, gender, and age makes the guidance more precise.",
        mockHighlight: 1,
      },
      {
        step: "Step 2",
        title: "Register allergies and conditions",
        text: "This is what changes the answers. Registered allergens are dropped from suggestions, and foods that clash with your condition come back one risk level higher.",
        tips: [
          "Press a group heading to open its items, or choose None if it does not apply.",
          "Not on the list? Type it in with direct entry.",
          "Press Speak to enter and your own words are kept as a note the AI reads too.",
        ],
        mockTitle: "Allergies · Conditions",
        mockItems: ["Milk", "Tree nuts", "🎙 Speak to enter"],
        mockNote: "Pick from the list or just say it",
        mockCaption: "Adding allergies and conditions lets us guide you more safely.",
        mockHighlight: 2,
      },
      {
        step: "Step 3",
        title: "Speak, snap, or type your question",
        text: "Use whichever is easiest. Dialect is understood. Send voice and a photo together and both are read as one question.",
        tips: [
          "For voice, press the big microphone, speak, then press once more to attach.",
          "For photos, choose label, food, or medicine first and we share how to shoot it.",
          "If the photo comes out dark or blurry, we tell you to take it again.",
        ],
        mockTitle: "Ways to ask",
        mockItems: ["🎙 Speak", "📷 Upload a photo", "⌨ Type it"],
        mockNote: "The common question buttons work too",
        mockCaption: "Speak it, snap a photo, or type it out.",
        mockHighlight: 1,
      },
      {
        step: "Step 4",
        title: "Turn the answer one card at a time",
        text: "Long answers are split across cards. The top shows something like 1 of 3, and the button below opens the next card.",
        tips: [
          "You can also swipe left or right to turn cards.",
          "The last card says the answer ends there.",
          "Press Read the answer again to hear it out loud.",
        ],
        mockTitle: "Conversation 1 · Answer 1/3",
        mockItems: ["Simmer the radish well and its own sweetness comes out. No sugar needed."],
        mockNote: "See the next card →",
        mockCaption: "Answers come as large-type cards and continue onto the next card.",
        mockHighlight: -1,
      },
    ],
    guideCta: "Try it now",
    previewBadge: "Real UI",
    previewTitle: "This is what the service screen looks like",
    previewDescription:
      "The intro screen goes wide, the service screen goes large. Both share the same deep green brand colour, but only the screen older adults use gets bigger type, bigger buttons, and thicker borders.",
    previewRiskTitle: "Risk shown three ways",
    previewRiskSafe: "Safe",
    previewDialectTitle: "Dialect to standard Korean",
    previewDialectFrom: "Jeong-gu-ji",
    previewDialectTo: "Chives",
    previewAnswerTitle: "Large-type answer card",
    previewAnswerText: "Simmer the radish well and its own sweetness comes out. No sugar needed.",
    previewMic: "🎙 Press to speak",
    footer:
      "© SilverLens. AI that understands dialects, improving access to healthy eating for older adults.",
  },
  "ja-JP": {
    backToService: "サービスに戻る",
    githubCta: "GitHub リポジトリを開く",
    teamTitle: "制作メンバー",
    navFeatures: "主要機能",
    navWorkflow: "利用の流れ",
    navGuide: "使い方",
    languageLabel: "言語を選ぶ",
    heroSecondaryCta: "今すぐ始める",
    brandSubtitle: "デジタル世界の疎外を消す光、SilverLens",
    heroTitle: "方言を理解するAI、",
    heroTitleAccent: "シニアのための健康な食生活",
    heroDescription: [
      "方言を理解するAIで、シニアにやさしく安全な健康情報を届けます。",
      "難しい表現を減らし、慣れた話し方でより安心なデジタル健康体験をつくります。",
    ],
    heroCta: "主要機能を見る",
    featuresBadge: "Core Features",
    featuresTitle: "誰でも簡単に使えるように、",
    featuresTitleAccent: "AIは見えないところで動きます",
    featuresDescription:
      "SilverLensは、シニアの方が技術を学ばなくても自然に使えるよう、複雑なAIの処理を後ろに隠し、気軽な質問と理解だけを残します。",
    features: [
      {
        title: "方言がわかる対話",
        text: "標準語中心のサービスで取り残されがちな地域の高齢者も、慣れた話し方でそのまま質問できます。",
      },
      {
        title: "やさしい文章に再構成",
        text: "難しい医療・栄養の情報を短くやさしい文に置き換えて説明し、理解の壁を下げます。",
      },
      {
        title: "安全を優先した案内",
        text: "不安をあおらずに要点をはっきり伝える方法で、健康情報を安心して活用できるようにします。",
      },
      {
        title: "すばやい情報アクセス",
        text: "必要な答えにすぐ届くよう質問の流れを単純にし、迷う時間を減らします。",
      },
      {
        title: "段階的な食生活ガイド",
        text: "何を食べるか、どう変えるかを日常の順序で案内し、実生活につなげます。",
      },
      {
        title: "慣れやすいデジタル体験",
        text: "大きな見出し、ゆったりした余白、整ったカード構成で、負担なく読める画面を提供します。",
      },
    ],
    workflowBadge: "Workflow",
    workflowTitle: "質問から理解まで、",
    workflowTitleAccent: "ひと目でわかる情報の流れ",
    workflowDescription:
      "難しい操作を覚える必要はありません。SilverLensは質問を理解し、やさしく説明し、暮らしの実践まで段階的に手助けします。",
    steps: [
      {
        step: "STEP 01",
        title: "質問する",
        text: "普段の話し方のまま、健康や食生活について尋ねられます。標準語でなくても意図は自然に伝わります。",
      },
      {
        step: "STEP 02",
        title: "意図を理解",
        text: "AIが方言と文脈を読み取り、本当の質問を把握して必要な健康情報の方向を整理します。",
      },
      {
        step: "STEP 03",
        title: "やさしく説明",
        text: "複雑な内容をやさしい言葉と短い文に置き換え、誰でも無理なく理解できる情報にします。",
      },
      {
        step: "STEP 04",
        title: "生活に適用",
        text: "理解した情報を毎日の食事、健康習慣、暮らしの選択にすぐ活かせるよう、行動中心で支えます。",
      },
    ],
    guideBadge: "How to use",
    guideTitle: "はじめてでも大丈夫、",
    guideTitleAccent: "四つの手順だけです",
    guideDescription:
      "登録もログインもありません。画面が開いたらすぐ質問できます。下の四つの手順は、より合った答えを受け取るためのものです。健康情報はこの端末だけに保存され、サーバーには送りません。",
    guideTipsLabel: "覚えておくと便利です",
    guideSteps: [
      {
        step: "手順 1",
        title: "言語・性別・年齢を選びます",
        text: "画面上の「自分の情報を入力」ボタンから開きます。性別と年齢は一日の推奨摂取量が変わる部分にだけ使い、入力しなくても会話はできます。",
        tips: [
          "最初の画面で「自分の情報を話す」を押して話すと、性別と年齢が一度に入ります。",
          "最初の画面にある性別・年齢のボタンを直接押して選ぶこともできます。",
          "押し間違えたら同じボタンをもう一度押して取り消せます。",
          "言語を変えると、登録した健康情報の表記も一緒に変わります。",
        ],
        mockTitle: "言語 · 性別 · 年齢",
        mockItems: ["日本語", "女性", "70代"],
        mockNote: "最初の画面で話すか押すだけでも大丈夫です",
        mockCaption: "言語・性別・年齢を選ぶと、より正確な案内を受けられます。",
        mockHighlight: 1,
      },
      {
        step: "手順 2",
        title: "アレルギーと疾患を登録します",
        text: "ここまで入れると答えが変わります。登録したアレルギー食品はおすすめから外れ、疾患に触れる食品は危険度を一段上げてお知らせします。",
        tips: [
          "グループの見出しを押すと項目が開きます。該当しなければ「該当なし」を押してください。",
          "一覧になければ「直接入力」で書けます。",
          "「話して入力」を押して話すと、その言葉がメモとして残り回答にも反映されます。",
        ],
        mockTitle: "アレルギー · 疾患",
        mockItems: ["牛乳", "ナッツ類", "🎙 話して入力"],
        mockNote: "一覧から選んでも、話してもいいです",
        mockCaption: "アレルギーと疾患を入れておくと、より安全に案内します。",
        mockHighlight: 2,
      },
      {
        step: "手順 3",
        title: "話す・撮る・書く、どれでも質問できます",
        text: "楽な方法を選んでください。方言のままでも通じます。音声と写真を一緒に送ると、ひとつの質問として理解します。",
        tips: [
          "音声は大きなマイクを押して話し、もう一度押すと添付されます。",
          "写真は成分表・料理・薬の袋のどれを撮るか先に選ぶと、撮り方をお伝えします。",
          "撮った写真が暗い、またはぼやけている場合は撮り直しをお知らせします。",
        ],
        mockTitle: "質問の方法",
        mockItems: ["🎙 音声で話す", "📷 写真を送る", "⌨ 文字で書く"],
        mockNote: "よくある質問ボタンからでも大丈夫です",
        mockCaption: "話すか、写真を送るか、直接書けば大丈夫です。",
        mockHighlight: 1,
      },
      {
        step: "手順 4",
        title: "回答を一枚ずつめくって読みます",
        text: "答えが長いときは何枚かに分けます。カードの上に「3枚中1枚」のように表示され、下のボタンを押すと次の枚が出ます。",
        tips: [
          "指で左右に払ってめくることもできます。",
          "最後の枚には、ここまでという案内が入ります。",
          "「回答をもう一度聞く」を押すと声で読み上げます。",
        ],
        mockTitle: "会話 1 · 回答 1/3",
        mockItems: ["大根をよく煮ると甘みが出ます。砂糖は入れなくて大丈夫です。"],
        mockNote: "次の枚を見る →",
        mockCaption: "大きな文字のカードで見せ、長ければ次のカードへ続きます。",
        mockHighlight: -1,
      },
    ],
    guideCta: "すぐに始めてみる",
    previewBadge: "Real UI",
    previewTitle: "サービス画面はこんな見た目です",
    previewDescription:
      "紹介画面は広く、サービス画面は大きく。同じディープグリーンを使いながら、シニアが使う画面だけ文字とボタンを大きくし、枠線を太くしています。",
    previewRiskTitle: "危険度の3重表示",
    previewRiskSafe: "安全",
    previewDialectTitle: "方言から標準語へ",
    previewDialectFrom: "チョングジ",
    previewDialectTo: "ニラ",
    previewAnswerTitle: "大きな文字の回答カード",
    previewAnswerText: "大根をよく煮ると甘みが出ます。砂糖は入れなくて大丈夫です。",
    previewMic: "🎙 押して話す",
    footer: "© SilverLens. 方言を理解するAIで、シニアの健康な食生活へのアクセスを高めます。",
  },
};

const aboutFeatureIcons = [
  <svg key="chat" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
    <path d="M4 7c0-1.1.9-2 2-2h12c1.1 0 2 .9 2 2v7c0 1.1-.9 2-2 2H9l-5 3V7Z" />
    <path d="M8 10h8M8 13h5" />
  </svg>,
  <svg key="lines" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
    <path d="M7 7h10M7 12h6M7 17h10" />
    <rect x="4" y="4" width="16" height="16" rx="3" />
  </svg>,
  <svg key="shield" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
    <path d="M12 3l7 4v5c0 4.5-3 7.8-7 9-4-1.2-7-4.5-7-9V7l7-4Z" />
    <path d="m9 12 2 2 4-4" />
  </svg>,
  <svg key="clock" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
    <circle cx="12" cy="12" r="8" />
    <path d="M12 8v4l3 2" />
  </svg>,
  <svg key="steps" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
    <path d="M12 20h9" />
    <path d="M12 4h9" />
    <path d="M3 6h4v4H3z" />
    <path d="M3 14h4v4H3z" />
  </svg>,
  <svg key="target" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
    <path d="M12 3v18M3 12h18" />
    <circle cx="12" cy="12" r="8" />
  </svg>,
];

const aboutStepIcons = [
  <svg key="ask" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
    <path d="M4 7c0-1.1.9-2 2-2h12c1.1 0 2 .9 2 2v7c0 1.1-.9 2-2 2H9l-5 3V7Z" />
    <path d="M8 10h8M8 13h5" />
  </svg>,
  <svg key="search" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
    <path d="M10 6a6 6 0 1 0 0 12 6 6 0 0 0 0-12Z" />
    <path d="m21 21-5.2-5.2" />
  </svg>,
  <svg key="doc" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
    <path d="M6 4h9l3 3v13H6z" />
    <path d="M9 12h6M9 16h6M9 8h3" />
  </svg>,
  <svg key="arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
    <path d="M5 12h14" />
    <path d="M12 5l7 7-7 7" />
  </svg>,
];

const aboutGuideIcons = [
  <svg key="person" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
    <circle cx="12" cy="8" r="3.5" />
    <path d="M5 20c0-3.3 3.1-5.5 7-5.5s7 2.2 7 5.5" />
  </svg>,
  <svg key="clipboard" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
    <path d="M9 4h6v3H9z" />
    <path d="M7 5H5v15h14V5h-2" />
    <path d="M9 12h6M9 16h4" />
  </svg>,
  <svg key="mic" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
    <rect x="9" y="3" width="6" height="10" rx="3" />
    <path d="M6 11a6 6 0 0 0 12 0" />
    <path d="M12 17v4M9 21h6" />
  </svg>,
  <svg key="cards" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
    <rect x="3" y="6" width="12" height="13" rx="2" />
    <path d="M8 3h11a2 2 0 0 1 2 2v11" />
    <path d="M6 11h6M6 15h4" />
  </svg>,
];

/**
 * 실제 화면을 흉내 낸 작은 목업.
 *
 * 서비스 화면을 어둡게 띄우고 눌러야 할 곳만 밝게 남긴 뒤, 아래에 흰 글씨로
 * 한 문장을 얹는다. 어르신용 사용 안내에서 흔히 쓰는 방식이라 어디를 누르면
 * 되는지 한눈에 들어온다. 스크린샷 대신 CSS로 그려서 서비스 화면을 고쳐도
 * 그림이 낡지 않고 용량도 늘지 않는다.
 *
 * 장식이라 스크린 리더에서는 숨기고, 설명은 옆의 글과 팁 목록이 담당한다.
 */
function AboutGuideMock({ index, step }: { index: number; step: AboutGuideStep }) {
  const itemClass = (itemIndex: number, base: string) =>
    itemIndex === step.mockHighlight ? `${base} highlight` : base;

  return (
    <figure className="about-guide-mock" aria-hidden="true">
      <div className="about-guide-mock-screen">
        <span className="about-guide-mock-title">{step.mockTitle}</span>

        {index === 3 ? (
          <>
            <p className="about-guide-mock-answer">{step.mockItems[0]}</p>
            <span className="about-guide-mock-next">{step.mockNote}</span>
          </>
        ) : index === 2 ? (
          <>
            <div className="about-guide-mock-stack">
              {step.mockItems.map((item, itemIndex) => (
                <span className={itemClass(itemIndex, "about-guide-mock-button")} key={item}>
                  {item}
                  {itemIndex === step.mockHighlight && (
                    <span className="about-guide-mock-hand">👆</span>
                  )}
                </span>
              ))}
            </div>
            <span className="about-guide-mock-note">{step.mockNote}</span>
          </>
        ) : (
          <>
            <div className="about-guide-mock-chips">
              {step.mockItems.map((item, itemIndex) => (
                <span className={itemClass(itemIndex, "about-guide-mock-chip")} key={item}>
                  {item}
                  {itemIndex === step.mockHighlight && (
                    <span className="about-guide-mock-hand">👆</span>
                  )}
                </span>
              ))}
            </div>
            <span className="about-guide-mock-note">{step.mockNote}</span>
          </>
        )}
      </div>

      <figcaption className="about-guide-mock-caption">{step.mockCaption}</figcaption>
    </figure>
  );
}

type BrowserNarrationState = {
  pages: string[];
  pageIndex: number;
  chunkIndex: number;
  firstCardIndex: number | null;
  lang: Language;
};

function isMobileBrowser() {
  if (typeof navigator === "undefined") return false;
  return /Android|iPhone|iPad|iPod|IEMobile|Mobile|Silk|Kindle/i.test(
    navigator.userAgent,
  );
}

function baseLanguageTag(tag: string) {
  return tag.toLowerCase().replace(/_/g, "-").split("-")[0];
}

function listSpeechVoices(): SpeechSynthesisVoice[] {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return [];
  try {
    return window.speechSynthesis.getVoices();
  } catch {
    return [];
  }
}

let speechVoicesReady: Promise<void> | null = null;

/**
 * 크롬은 첫 호출에서 getVoices()가 빈 배열을 반환한다.
 * 음성 목록이 채워질 때까지(최대 1.2초) 기다려야 로컬 음성을 고를 수 있다.
 */
function ensureSpeechVoicesReady() {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) {
    return Promise.resolve();
  }
  if (listSpeechVoices().length > 0) return Promise.resolve();
  if (!speechVoicesReady) {
    speechVoicesReady = new Promise<void>((resolve) => {
      const synth = window.speechSynthesis;
      let timer = 0;
      const finish = () => {
        synth.removeEventListener("voiceschanged", finish);
        window.clearTimeout(timer);
        resolve();
      };
      synth.addEventListener("voiceschanged", finish);
      timer = window.setTimeout(finish, 1200);
    });
  }
  return speechVoicesReady;
}

/** 같은 언어의 음성 중 기기 내장(local) 음성을 우선 선택한다. */
function pickSpeechVoice(lang: Language) {
  const base = baseLanguageTag(lang);
  const matches = listSpeechVoices().filter(
    (voice) => baseLanguageTag(voice.lang) === base,
  );
  if (matches.length === 0) return null;
  const exact = matches.filter(
    (voice) => voice.lang.toLowerCase().replace(/_/g, "-") === lang.toLowerCase(),
  );
  const pool = exact.length > 0 ? exact : matches;
  return pool.find((voice) => voice.localService) ?? pool[0];
}

/**
 * 데스크톱 크롬/엣지는 한국어 음성에서 utterance.rate가 반영되지 않는 사례가 확인됐다.
 * (네트워크 음성인 "Google 한국의"뿐 아니라 로컬 음성에서도 동일)
 * 이 경우 서버 TTS(Gemini WAV) + audio.playbackRate 경로로 우회한다.
 */
function browserRateIsReliable(voice: SpeechSynthesisVoice | null, lang: Language) {
  if (isMobileBrowser()) return true;
  if (baseLanguageTag(lang) === "ko") return false;
  if (!voice) return false;
  return voice.localService;
}

/** 데스크톱 한국어는 브라우저 음성 속도를 신뢰할 수 없어 서버 TTS를 먼저 쓴다. */
function shouldPreferServerTts(lang: Language) {
  return !isMobileBrowser() && baseLanguageTag(lang) === "ko";
}

function isDefaultNarrationRate(rate: number) {
  return Math.abs(rate - narrationRateOptions[DEFAULT_RATE_INDEX].value) < 0.01;
}

/**
 * 지금 설정에서 서버 TTS가 꼭 필요한지 판단한다.
 *
 * 서버 TTS는 조각마다 생성 시간이 붙는다(실측 ko-KR: 19자 약 5초, 178자 약 20초).
 * 속도를 손대지 않은 기본 상태에서는 브라우저가 rate를 무시해도 실제 차이가
 * 5% 미만이라 들리지 않으므로, 지연이 전혀 없는 브라우저 음성을 그대로 쓴다.
 * 어르신이 속도를 옮긴 순간부터 서버 TTS로 넘어가 슬라이더가 확실히 반영된다.
 */
function needsServerNarration(
  voice: SpeechSynthesisVoice | null,
  lang: Language,
  rate: number,
) {
  if (isDefaultNarrationRate(rate)) return false;
  if (shouldPreferServerTts(lang)) return true;
  return !browserRateIsReliable(voice, lang);
}

/**
 * rate가 통하지 않는 브라우저에서 쓰는 보조 수단.
 * 문장을 짧게 끊고 사이에 쉬는 시간을 넣어 실제 듣는 속도를 늦춘다.
 */
function narrationGapMs(rate: number) {
  const baseline = narrationRateOptions[DEFAULT_RATE_INDEX].value;
  if (rate >= baseline) return 0;
  return Math.round((baseline - rate) * 3200);
}

/**
 * 방언 변환 서버 주소를 쓸 수 있는지 판단한다.
 *
 * NEXT_PUBLIC_ 값은 빌드 시점에 클라이언트 번들에 박히므로, 개발용
 * `http://127.0.0.1:8001`이 배포본에 그대로 실려 나갈 수 있다. 그러면 방문자
 * 브라우저가 자기 PC의 8001 포트를 찾게 되고, HTTPS 사이트에서는 혼합 콘텐츠로
 * 차단된다. 그래서 화면이 로컬에서 열렸을 때만 로컬 주소를 쓴다.
 */
function usableDialectApiUrl() {
  const raw = process.env.NEXT_PUBLIC_DIALECT_API_URL?.trim();
  if (!raw || typeof window === "undefined") return null;

  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return null;
  }

  const isLocalTarget = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(target.hostname);
  const isLocalPage = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(
    window.location.hostname,
  );
  if (isLocalTarget && !isLocalPage) return null;

  // HTTPS 페이지에서 HTTP 주소를 부르면 브라우저가 막으므로 미리 건너뛴다.
  if (window.location.protocol === "https:" && target.protocol === "http:") {
    return null;
  }
  return raw;
}

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
  copy,
}: {
  active: PageScreen;
  onNavigate: (screen: PageScreen) => void;
  copy: (typeof uiCopy)[Language];
}) {
  return (
    <aside className="sidebar" aria-label={copy.menuLabel}>
      <div className="brand">
        <span className="brand-mark">SL</span>
        <span>{copy.brand}</span>
      </div>
      <nav>
        <button
          className={active === "setup" || active === "chat" ? "nav-item active" : "nav-item"}
          onClick={() => onNavigate(active === "chat" ? "chat" : "setup")}
        >
          <span aria-hidden="true">⌂</span>
          {copy.service}
        </button>
        <button
          className={active === "about" ? "nav-item active" : "nav-item"}
          onClick={() => onNavigate("about")}
        >
          <span aria-hidden="true">▤</span>
          {copy.about}
        </button>
      </nav>
      <div className="sidebar-note">
        <strong>{copy.sidebarTitle}</strong>
        <span>{copy.sidebarNote}</span>
      </div>
    </aside>
  );
}

function QuickAskButtons({
  items,
  language,
  disabled,
  onPick,
  variant,
}: {
  items: QuickAsk[];
  language: Language;
  disabled: boolean;
  onPick: (item: QuickAsk) => void;
  variant: "large" | "compact";
}) {
  return (
    <div className={`quick-asks ${variant}`}>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          className="quick-ask"
          onClick={() => onPick(item)}
          disabled={disabled}
        >
          <span aria-hidden="true">{item.icon}</span>
          <strong>{item.label[language]}</strong>
        </button>
      ))}
    </div>
  );
}

/**
 * 알레르기·질병 선택 카드.
 * 화면을 짧게 유지하려고 기본 상태에서는 선택 결과만 보여 주고,
 * "직접 입력"을 눌렀을 때 글자 입력칸과 묶음 목록을 함께 펼친다.
 */
function HealthPickerCard({
  kind,
  title,
  help,
  copy,
  language,
  datalistId,
  inputLabel,
  options,
  groups,
  selectedIds,
  open,
  onToggleOpen,
  onToggleId,
  onClear,
  onRemoveId,
  onAddTag,
  isRecording,
  onRecord,
  recordDisabled,
}: {
  kind: HealthKind;
  title: string;
  help: string;
  copy: (typeof uiCopy)[Language];
  language: Language;
  datalistId: string;
  inputLabel: string;
  options: Array<{ id: string; label: string }>;
  groups: ReturnType<typeof getHealthGroupOptions>;
  selectedIds: string[];
  open: boolean;
  onToggleOpen: () => void;
  onToggleId: (id: string) => void;
  onClear: () => void;
  onRemoveId: (id: string) => void;
  onAddTag: (event: KeyboardEvent<HTMLInputElement>) => void;
  isRecording: boolean;
  onRecord: () => void;
  recordDisabled: boolean;
}) {
  const hasSelection = selectedIds.length > 0;

  return (
    <section className={open ? "health-card open" : "health-card"}>
      <div className="health-title">
        <h2>{title}</h2>
      </div>
      <p>{help}</p>
      <div className="health-actions">
        <button
          type="button"
          className={open ? "health-toggle open" : "health-toggle"}
          aria-expanded={open}
          onClick={onToggleOpen}
        >
          {open ? copy.directInputClose : copy.directInput}
        </button>
        <button
          type="button"
          className={isRecording ? "recording" : ""}
          onClick={onRecord}
          disabled={recordDisabled}
        >
          {isRecording ? copy.recordingDone : copy.voiceInput}
        </button>
      </div>

      <div className="health-summary">
        {hasSelection ? (
          <>
            <span className="health-summary-count">
              {copy.selectedSummary.replace("{count}", String(selectedIds.length))}
            </span>
            {selectedIds.map((id) => (
              <button
                key={id}
                type="button"
                className={`health-chip ${kind}`}
                onClick={() => onRemoveId(id)}
                aria-label={`${getHealthLabel(id, language)} ${copy.clearSelection}`}
              >
                {getHealthLabel(id, language)} <span aria-hidden="true">×</span>
              </button>
            ))}
          </>
        ) : (
          <span className="health-summary-empty">{copy.noneOption}</span>
        )}
      </div>

      {open && (
        <div className="health-picker">
          <input
            autoFocus
            placeholder={copy.inputPlaceholder}
            list={datalistId}
            onKeyDown={onAddTag}
            aria-label={inputLabel}
          />
          <datalist id={datalistId}>
            {options.map((item) => (
              <option key={item.id} value={item.label} />
            ))}
          </datalist>
          <div className="health-picker-head">
            <small>{copy.pickerHint}</small>
            <button
              type="button"
              className="health-clear"
              onClick={onClear}
              disabled={!hasSelection}
            >
              {copy.clearSelection}
            </button>
          </div>
          {groups.map((group) => {
            const chosen = group.items.filter((item) =>
              selectedIds.includes(item.id),
            ).length;
            return (
              <details
                key={group.id}
                className={chosen > 0 ? "health-group has-selection" : "health-group"}
                open={chosen > 0}
              >
                <summary>
                  <span className="health-group-icon" aria-hidden="true">
                    {group.icon}
                  </span>
                  <strong>{group.title}</strong>
                  <em>
                    {chosen > 0 ? `${chosen} / ` : ""}
                    {group.items.length}
                  </em>
                </summary>
                <ul
                  className={`health-option-list ${kind}`}
                  role="listbox"
                  aria-multiselectable="true"
                  aria-label={`${title} · ${group.title}`}
                >
                  {group.items.map((item) => {
                    const selected = selectedIds.includes(item.id);
                    return (
                      <li key={item.id}>
                        <button
                          type="button"
                          role="option"
                          aria-selected={selected}
                          className={`health-option${selected ? " selected" : ""}`}
                          onClick={() => onToggleId(item.id)}
                        >
                          <span>{item.label}</span>
                          {selected && (
                            <span className="check-mark" aria-hidden="true">✓</span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </details>
            );
          })}
        </div>
      )}
    </section>
  );
}

export default function SilverLensApp() {
  /*
   * 첫 화면은 대화 화면이다.
   * 어르신에게 언어·성별·나이·알레르기·질병을 먼저 다 채우게 하면 대화에 닿기 전에
   * 지쳐 이탈한다. 그래서 바로 말할 수 있게 두고, 정보 입력은 버튼으로 안내한다.
   */
  const [screen, setScreen] = useState<PageScreen>("chat");
  const [language, setLanguage] = useState<Language | null>(null);
  const [gender, setGender] = useState<Gender | null>(null);
  const [ageBand, setAgeBand] = useState(70);
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [allergyIds, setAllergyIds] = useState<string[]>([]);
  const [conditionIds, setConditionIds] = useState<string[]>([]);
  const [autoVoiceGuide, setAutoVoiceGuide] = useState(true);
  const [narrationRateIndex, setNarrationRateIndex] = useState(DEFAULT_RATE_INDEX);
  const [voicePreferenceReady, setVoicePreferenceReady] = useState(false);
  const [showAllergyInput, setShowAllergyInput] = useState(false);
  const [showConditionInput, setShowConditionInput] = useState(false);
  const [healthNotes, setHealthNotes] = useState<HealthNote[]>([]);
  const [storeReady, setStoreReady] = useState(false);
  const [storeSavedAt, setStoreSavedAt] = useState<number | null>(null);
  const [storeKind, setStoreKind] = useState<
    "indexeddb" | "localstorage" | "none"
  >("none");
  const [backupNotice, setBackupNotice] = useState("");
  const [recordingContext, setRecordingContext] = useState<RecordingContext | null>(null);
  const [recordedUrl, setRecordedUrl] = useState<string | null>(null);
  const [pendingAudio, setPendingAudio] = useState<PendingAudio | null>(null);
  const [pendingImage, setPendingImage] = useState<PendingImage | null>(null);
  /** 사진 흐름 단계. null 이면 아무 창도 열려 있지 않다. */
  const [photoStep, setPhotoStep] = useState<"purpose" | "review" | null>(null);
  /** 카메라를 열기 직전에 고른 촬영 목적. 다시 찍기에서도 그대로 쓴다. */
  const [photoPurpose, setPhotoPurpose] = useState<PhotoPurpose | null>(null);
  const [isPreparingPhoto, setIsPreparingPhoto] = useState(false);
  const [isPhotoZoomOpen, setIsPhotoZoomOpen] = useState(false);
  /** 대화 화면 헤더의 언어 알약이 펼쳐져 있는지. */
  const [isLanguageOpen, setIsLanguageOpen] = useState(false);
  const [recordingError, setRecordingError] = useState("");
  const [chatInput, setChatInput] = useState("");
  const [chatTurns, setChatTurns] = useState<ChatTurn[]>([]);
  const [answerCardIndex, setAnswerCardIndex] = useState(0);
  const [chatError, setChatError] = useState("");
  const [isLoadingAnswer, setIsLoadingAnswer] = useState(false);
  const [isNarrating, setIsNarrating] = useState(false);
  const [isTranscribingVoice, setIsTranscribingVoice] = useState(false);
  const [narrationStatus, setNarrationStatus] = useState<Record<string, NarrationStatus>>({});
  const [voiceRateMode, setVoiceRateMode] = useState<
    "server" | "browser" | "browser-limited" | null
  >(null);
  const [showTextInput, setShowTextInput] = useState(false);
  const [profileVoiceNotice, setProfileVoiceNotice] = useState("");
  const [transcript, setTranscript] = useState("");
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const narrationAudioRef = useRef<HTMLAudioElement | null>(null);
  const narrationUrlRef = useRef<string | null>(null);
  const narrationFinishRef = useRef<(() => void) | null>(null);
  const narrationChunksRef = useRef<Map<string, NarrationPageRequests>>(new Map());
  const narrationControllersRef = useRef<Set<AbortController>>(new Set());
  const narrationSequenceRef = useRef(0);
  const narrationRateRef = useRef<number>(
    narrationRateOptions[DEFAULT_RATE_INDEX].value,
  );
  const browserNarrationRef = useRef<BrowserNarrationState | null>(null);
  const rateRestartTimerRef = useRef<number | null>(null);
  const paceTimerRef = useRef<number | null>(null);
  const startTimerRef = useRef<number | null>(null);
  const activeAudiosRef = useRef<Set<HTMLAudioElement>>(new Set());
  const guideControllersRef = useRef<Set<AbortController>>(new Set());
  /** 안내 음성(고정 문장) 오디오 재사용 캐시. */
  const guideAudioCacheRef = useRef<Map<string, Blob>>(new Map());
  /** 서버 TTS가 실패하면 잠시만 쉬고 다시 시도한다(영구 차단 방지). */
  const serverTtsBlockedUntilRef = useRef(0);
  const announceTimerRef = useRef<number | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordingStartedAtRef = useRef<number | null>(null);
  const initialTtsPlayed = useRef(false);
  const answerTouchStartX = useRef<number | null>(null);
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const backupInputRef = useRef<HTMLInputElement | null>(null);
  const languageSectionRef = useRef<HTMLFieldSetElement | null>(null);
  const genderSectionRef = useRef<HTMLFieldSetElement | null>(null);
  const ageSectionRef = useRef<HTMLFieldSetElement | null>(null);

  const nextStep = getNextStep(language, gender, ageConfirmed);
  const activeLanguage = language ?? "ko-KR";
  const activeCopy = uiCopy[activeLanguage];
  const narrationRate = narrationRateOptions[narrationRateIndex].value;
  const narrationRateLabel = narrationRateOptions[narrationRateIndex].label[activeLanguage];
  const allergyOptions = useMemo(
    () => getHealthOptions("allergy", activeLanguage),
    [activeLanguage],
  );
  const conditionOptions = useMemo(
    () => getHealthOptions("condition", activeLanguage),
    [activeLanguage],
  );
  const allergyGroups = useMemo(
    () => getHealthGroupOptions("allergy", activeLanguage),
    [activeLanguage],
  );
  const conditionGroups = useMemo(
    () => getHealthGroupOptions("condition", activeLanguage),
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
    browserNarrationRef.current = null;

    if (rateRestartTimerRef.current !== null) {
      window.clearTimeout(rateRestartTimerRef.current);
      rateRestartTimerRef.current = null;
    }

    if (paceTimerRef.current !== null) {
      window.clearTimeout(paceTimerRef.current);
      paceTimerRef.current = null;
    }

    if (startTimerRef.current !== null) {
      window.clearTimeout(startTimerRef.current);
      startTimerRef.current = null;
    }

    if (announceTimerRef.current !== null) {
      window.clearTimeout(announceTimerRef.current);
      announceTimerRef.current = null;
    }

    // 언어를 바꾸는 순간 이전 언어의 안내 음성 요청이 남아 겹치는 것을 막는다.
    guideControllersRef.current.forEach((controller) => controller.abort());
    guideControllersRef.current.clear();

    // 참조가 어긋난 오디오까지 확실히 멈춘다.
    activeAudiosRef.current.forEach((item) => {
      item.pause();
      try {
        item.currentTime = 0;
      } catch {
        // 로드 전 오디오는 currentTime 설정이 실패할 수 있다.
      }
    });
    activeAudiosRef.current.clear();

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

  const runBrowserNarration = useCallback(
    (options: {
      pages: string[];
      startPage: number;
      startChunk: number;
      firstCardIndex: number | null;
      lang: Language;
    }) => {
      if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
      const { pages, startPage, startChunk, firstCardIndex, lang } = options;
      stopNarration();
      if (pages.length === 0) return;

      const sequence = narrationSequenceRef.current;
      const voice = pickSpeechVoice(lang);
      const rate = narrationRateRef.current;
      // rate가 무시되는 브라우저에서는 끊어 읽기 + 쉬는 시간으로 속도를 흉내낸다.
      const gapMs = browserRateIsReliable(voice, lang) ? 0 : narrationGapMs(rate);
      const chunkChars = gapMs > 0 ? 60 : 180;
      setIsNarrating(true);

      const speakPage = (pageIndex: number, chunkOffset: number) => {
        if (sequence !== narrationSequenceRef.current) return;
        if (pageIndex >= pages.length) {
          browserNarrationRef.current = null;
          setIsNarrating(false);
          return;
        }
        if (firstCardIndex !== null) setAnswerCardIndex(firstCardIndex + pageIndex);
        const chunks = splitNarrationText(pages[pageIndex], chunkChars);

        const speakChunk = (chunkIndex: number) => {
          if (sequence !== narrationSequenceRef.current) return;
          if (chunkIndex >= chunks.length) {
            speakPage(pageIndex + 1, 0);
            return;
          }
          browserNarrationRef.current = {
            pages,
            pageIndex,
            chunkIndex,
            firstCardIndex,
            lang,
          };
          const utterance = new SpeechSynthesisUtterance(chunks[chunkIndex]);
          if (voice) utterance.voice = voice;
          utterance.lang = voice?.lang ?? lang;
          utterance.rate = rate;
          utterance.pitch = 1.02;
          utterance.addEventListener(
            "end",
            () => {
              if (sequence !== narrationSequenceRef.current) return;
              if (gapMs <= 0) {
                speakChunk(chunkIndex + 1);
                return;
              }
              paceTimerRef.current = window.setTimeout(() => {
                paceTimerRef.current = null;
                speakChunk(chunkIndex + 1);
              }, gapMs);
            },
            { once: true },
          );
          utterance.addEventListener(
            "error",
            () => {
              if (sequence !== narrationSequenceRef.current) return;
              browserNarrationRef.current = null;
              setIsNarrating(false);
            },
            { once: true },
          );
          window.speechSynthesis.speak(utterance);
        };

        if (chunks.length === 0) speakPage(pageIndex + 1, 0);
        else speakChunk(Math.min(Math.max(chunkOffset, 0), Math.max(chunks.length - 1, 0)));
      };

      console.info(
        `[SilverLens] 음성 경로: 브라우저 (${lang}) voice=${voice?.name ?? "기본"} local=${
          voice?.localService ?? "?"
        } rate=${rate} gap=${gapMs}ms`,
      );

      // 크롬은 cancel() 직후 speak()를 호출하면 이전 음성이 끊기지 않고 겹칠 수 있다.
      startTimerRef.current = window.setTimeout(() => {
        startTimerRef.current = null;
        speakPage(Math.max(startPage, 0), startChunk);
      }, 140);
    },
    [stopNarration],
  );

  const fetchNarrationChunk = useCallback(
    async (
      text: string,
      lang: Language,
      /** 안내 음성은 정지·언어 변경 시 즉시 취소해야 해서 별도 집합을 쓴다. */
      controllerSet: Set<AbortController> = narrationControllersRef.current,
    ) => {
    const controller = new AbortController();
    controllerSet.add(controller);
    try {
      const response = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, language: lang }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as {
          error?: string;
          retryAfterSeconds?: number;
        };
        if (response.status === 429) {
          // 서버가 알려준 대기 시간만큼만 브라우저 음성으로 버틴다.
          const seconds = Number(payload.retryAfterSeconds);
          const waitMs = (Number.isFinite(seconds) && seconds > 0 ? seconds : 60) * 1000;
          serverTtsBlockedUntilRef.current = Date.now() + waitMs;
        }
        throw new Error(payload.error || "Gemini TTS를 사용할 수 없습니다.");
      }
      return await response.blob();
    } finally {
      controllerSet.delete(controller);
    }
    },
    [],
  );

  /**
   * 안내 문구는 같은 문장이 반복되므로 한 번 만든 음성을 재사용한다.
   * Gemini TTS 무료 한도(분당 요청 수)를 넘기지 않기 위한 장치.
   */
  const fetchGuideNarrationChunk = useCallback(
    async (text: string, lang: Language) => {
      const key = `${lang}:${text}`;
      const cached = guideAudioCacheRef.current.get(key);
      if (cached) return cached;

      const cacheUrl = `/__silverlens-tts/${encodeURIComponent(lang)}/${encodeURIComponent(text)}`;
      if (typeof caches !== "undefined") {
        try {
          const store = await caches.open(TTS_CACHE_NAME);
          const hit = await store.match(cacheUrl);
          if (hit) {
            const blob = await hit.blob();
            guideAudioCacheRef.current.set(key, blob);
            return blob;
          }
        } catch {
          // 캐시를 쓸 수 없는 환경은 그대로 네트워크로 진행한다.
        }
      }

      const blob = await fetchNarrationChunk(text, lang, guideControllersRef.current);
      guideAudioCacheRef.current.set(key, blob);
      if (typeof caches !== "undefined") {
        try {
          const store = await caches.open(TTS_CACHE_NAME);
          await store.put(
            cacheUrl,
            new Response(blob, { headers: { "Content-Type": "audio/wav" } }),
          );
        } catch {
          // 저장 실패는 재생에 영향을 주지 않는다.
        }
      }
      return blob;
    },
    [fetchNarrationChunk],
  );

  const playNarrationPages = useCallback(
    async (
      pageRequests: NarrationPageRequests,
      startPage: number,
      firstCardIndex: number | null,
      sequence: number,
    ) => {
      /**
       * 지금 조각을 재생하는 동안 다음 조각을 미리 만들어 둔다.
       * 조각 하나 생성이 5~20초 걸리므로, 재생 시간과 겹쳐 두지 않으면
       * 페이지가 넘어갈 때마다 침묵이 생긴다.
       */
      const warmUpAhead = (pageIndex: number, chunkIndex: number) => {
        let remaining = NARRATION_PREFETCH_AHEAD;
        let page = pageIndex;
        let chunk = chunkIndex + 1;
        while (remaining > 0 && page < pageRequests.length) {
          const chunks = pageRequests[page];
          if (chunk >= chunks.length) {
            page += 1;
            chunk = 0;
            continue;
          }
          void chunks[chunk]().catch(() => {
            // 미리 만들다 실패하면 실제 재생 순서에서 다시 시도한다.
          });
          chunk += 1;
          remaining -= 1;
        }
      };

      for (
        let pageIndex = Math.max(startPage, 0);
        pageIndex < pageRequests.length;
        pageIndex += 1
      ) {
        if (sequence !== narrationSequenceRef.current) return;
        if (firstCardIndex !== null) setAnswerCardIndex(firstCardIndex + pageIndex);

        const pageChunks = pageRequests[pageIndex];
        for (let chunkIndex = 0; chunkIndex < pageChunks.length; chunkIndex += 1) {
          if (sequence !== narrationSequenceRef.current) return;
          // 실제로 읽을 순서가 됐을 때 처음 요청한다(듣지 않는 뒷장은 호출하지 않음).
          const blob = await pageChunks[chunkIndex]();
          if (sequence !== narrationSequenceRef.current) return;
          warmUpAhead(pageIndex, chunkIndex);

          const url = URL.createObjectURL(blob);
          const audio = new Audio();
          audio.preload = "auto";

          /**
           * 오디오가 로드되면 playbackRate가 defaultPlaybackRate(1)로 초기화된다.
           * 그래서 두 값을 함께 지정하고, 로드·재생 시점마다 다시 적용한다.
           */
          const applyRate = () => {
            const rate = narrationRateRef.current;
            audio.defaultPlaybackRate = rate;
            if (audio.playbackRate !== rate) audio.playbackRate = rate;
          };
          audio.addEventListener("loadedmetadata", applyRate);
          audio.addEventListener("canplay", applyRate);
          audio.addEventListener("playing", applyRate);
          applyRate();
          audio.src = url;
          applyRate();

          activeAudiosRef.current.add(audio);
          narrationUrlRef.current = url;
          narrationAudioRef.current = audio;
          setIsNarrating(true);

          await new Promise<void>((resolve, reject) => {
            let settled = false;
            const finish = (error?: Error) => {
              if (settled) return;
              settled = true;
              audio.removeEventListener("loadedmetadata", applyRate);
              audio.removeEventListener("canplay", applyRate);
              audio.removeEventListener("playing", applyRate);
              activeAudiosRef.current.delete(audio);
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
            audio
              .play()
              .then(applyRate)
              .catch((error: unknown) =>
                finish(
                  error instanceof Error
                    ? error
                    : new Error("Gemini 음성을 재생하지 못했습니다."),
                ),
              );
          });
        }
      }
    },
    [],
  );

  /** 브라우저 음성이 속도를 무시하는 환경에서 쓰는 서버 TTS 경로. */
  const speakPagesWithServerTts = useCallback(
    async (
      pages: string[],
      startPage: number,
      firstCardIndex: number | null,
      lang: Language,
      onFailure: () => void,
    ) => {
      stopNarration();
      const sequence = narrationSequenceRef.current;
      const pageRequests: NarrationPageRequests = pages.map((page, pageIndex) =>
        splitNarrationForSpeech(plainTextFromMarkdown(page), pageIndex === 0).map(
          (chunk) => lazyNarrationChunk(() => fetchGuideNarrationChunk(chunk, lang)),
        ),
      );
      if (pageRequests.flat().length === 0) return;

      setIsNarrating(true);
      try {
        await playNarrationPages(pageRequests, startPage, firstCardIndex, sequence);
        if (sequence === narrationSequenceRef.current) setIsNarrating(false);
      } catch (error) {
        // 429가 아니어서 대기 시간을 못 받은 경우에만 기본 60초를 적용한다.
        if (Date.now() >= serverTtsBlockedUntilRef.current) {
          serverTtsBlockedUntilRef.current = Date.now() + 60_000;
        }
        console.warn(
          "[SilverLens] 서버 TTS 사용 불가 → 브라우저 음성으로 전환합니다.",
          error,
        );
        if (sequence !== narrationSequenceRef.current) return;
        onFailure();
      }
    },
    [fetchGuideNarrationChunk, playNarrationPages, stopNarration],
  );

  const speakGuideNarration = useCallback(
    (text: string, lang: Language = activeLanguage) => {
      if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
      const speakInBrowser = (startPage = 0, startChunk = 0) =>
        runBrowserNarration({
          pages: [text],
          startPage,
          startChunk,
          firstCardIndex: null,
          lang,
        });

      const sequence = narrationSequenceRef.current;
      void ensureSpeechVoicesReady().then(() => {
        if (sequence !== narrationSequenceRef.current) return;
        const rate = narrationRateRef.current;
        const voice = pickSpeechVoice(lang);
        const serverBlocked = Date.now() < serverTtsBlockedUntilRef.current;
        const needsServer = needsServerNarration(voice, lang, rate);

        if (!serverBlocked && needsServer) {
          console.info(`[SilverLens] 음성 경로: 서버 TTS (${lang}, rate=${rate})`);
          setVoiceRateMode("server");
          void speakPagesWithServerTts([text], 0, null, lang, () => speakInBrowser());
          return;
        }

        setVoiceRateMode(
          browserRateIsReliable(voice, lang) ? "browser" : "browser-limited",
        );
        speakInBrowser();
      });
    },
    [activeLanguage, runBrowserNarration, speakPagesWithServerTts],
  );

  const prepareGeminiAnswer = useCallback(
    (turnId: string, pages: string[], lang: Language = activeLanguage) => {
      const cacheKey = `${turnId}:${lang}`;
      const cached = narrationChunksRef.current.get(cacheKey);
      if (cached) return cached;

      const pageRequests: NarrationPageRequests = pages.map((page, pageIndex) =>
        splitNarrationForSpeech(plainTextFromMarkdown(page), pageIndex === 0).map(
          (chunk) =>
            lazyNarrationChunk(() =>
              fetchNarrationChunk(chunk, lang, narrationControllersRef.current),
            ),
        ),
      );
      if (pageRequests.flat().length === 0) return [];

      setNarrationStatus((current) => ({ ...current, [turnId]: "preparing" }));
      narrationChunksRef.current.set(cacheKey, pageRequests);

      /*
       * 첫 조각 하나만 기다린다. 첫 장 전체나 뒷장까지 기다리면
       * "음성 준비 중"이 20초 넘게 이어져 답변을 바로 들을 수 없다.
       * 나머지는 재생 중에 warmUpAhead 가 이어서 만든다.
       */
      const firstChunk = pageRequests[0]?.[0];
      if (!firstChunk) return pageRequests;
      void firstChunk().then(
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
      const plainPages = pages.map((page) => plainTextFromMarkdown(page));
      const sequence = narrationSequenceRef.current;
      void ensureSpeechVoicesReady().then(() => {
        if (sequence !== narrationSequenceRef.current) return;
        runBrowserNarration({
          pages: plainPages,
          startPage,
          startChunk: 0,
          firstCardIndex,
          lang,
        });
      });
    },
    [activeLanguage, runBrowserNarration],
  );

  /** 미리 만들어 둘지 결정할 때 쓰는 가벼운 판정. 음성 목록 로딩을 기다리지 않는다. */
  const serverNarrationNeeded = useCallback((lang: Language) => {
    if (typeof window === "undefined") return false;
    if (Date.now() < serverTtsBlockedUntilRef.current) return false;
    return needsServerNarration(
      pickSpeechVoice(lang),
      lang,
      narrationRateRef.current,
    );
  }, []);

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

      /*
       * 속도를 기본값으로 두었다면 서버 TTS를 부르지 않고 브라우저 음성으로 바로 읽는다.
       * 서버 TTS는 첫 소리까지 5~20초가 걸려 답변을 곧바로 들을 수 없다.
       */
      await ensureSpeechVoicesReady();
      if (sequence !== narrationSequenceRef.current) return;

      const rate = narrationRateRef.current;
      const voice = pickSpeechVoice(lang);
      const serverBlocked = Date.now() < serverTtsBlockedUntilRef.current;
      if (serverBlocked || !needsServerNarration(voice, lang, rate)) {
        setVoiceRateMode(
          browserRateIsReliable(voice, lang) ? "browser" : "browser-limited",
        );
        speakAnswerPagesWithBrowser(pages, startPage, firstCardIndex, lang);
        return;
      }

      setVoiceRateMode("server");
      const pageRequests = prepareGeminiAnswer(turnId, pages, lang);
      if (pageRequests.length === 0) return;

      try {
        await playNarrationPages(pageRequests, startPage, firstCardIndex, sequence);
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
      playNarrationPages,
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
        speakGuideNarration(text, lang);
      }, delay);
    },
    [speakGuideNarration, stopNarration],
  );

  const queueAutomaticNarration = useCallback(
    (text: string, lang: Language, delay: number) => {
      if (!autoVoiceGuide) return;
      queueBrowserNarration(text, lang, delay);
    },
    [autoVoiceGuide, queueBrowserNarration],
  );

  useEffect(() => {
    narrationRateRef.current = narrationRate;
  }, [narrationRate]);

  useEffect(() => {
    void ensureSpeechVoicesReady();
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const stored = window.localStorage.getItem("silverlens:auto-voice-guide");
      const enabled = stored !== "off";
      const storedRateRaw = window.localStorage.getItem(NARRATION_RATE_STORAGE_KEY);
      const storedRate = Number(storedRateRaw);
      setAutoVoiceGuide(enabled);
      if (
        storedRateRaw !== null &&
        Number.isInteger(storedRate) &&
        storedRate >= 0 &&
        storedRate < narrationRateOptions.length
      ) {
        setNarrationRateIndex(storedRate);
        narrationRateRef.current = narrationRateOptions[storedRate].value;
      }
      if (!enabled) initialTtsPlayed.current = true;
      setVoicePreferenceReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  /** 저장된 값을 화면 상태로 되살린다. 대화가 있으면 마지막 카드로 이동한다. */
  const applyStoredState = useCallback((value: unknown) => {
    const state = sanitizeStoredState(value);
    if (!state) return false;

    setLanguage(state.profile.language);
    setGender(state.profile.gender);
    setAgeBand(state.profile.ageBand);
    setAgeConfirmed(state.profile.ageConfirmed);
    setAllergyIds(state.profile.allergyIds);
    setConditionIds(state.profile.conditionIds);
    setHealthNotes(state.profile.healthNotes);
    setChatTurns(state.chatTurns);

    const totalPages = state.chatTurns.reduce(
      (total, turn) => total + turn.pages.length,
      0,
    );
    setAnswerCardIndex(Math.max(0, totalPages - 1));
    return true;
  }, []);

  const exportBackup = useCallback(() => {
    const snapshot: StoredState = {
      version: 1,
      savedAt: Date.now(),
      profile: {
        language,
        gender,
        ageBand,
        ageConfirmed,
        allergyIds,
        conditionIds,
        healthNotes,
      },
      chatTurns: chatTurns.slice(-MAX_STORED_TURNS),
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(snapshot, null, 2)], {
        type: "application/json",
      }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = BACKUP_FILE_NAME;
    anchor.click();
    URL.revokeObjectURL(url);
    setBackupNotice(activeCopy.backupExportDone);
  }, [
    activeCopy.backupExportDone,
    ageBand,
    ageConfirmed,
    allergyIds,
    chatTurns,
    conditionIds,
    gender,
    healthNotes,
    language,
  ]);

  const importBackup = useCallback(
    async (file: File) => {
      try {
        const parsed = JSON.parse(await file.text()) as unknown;
        setBackupNotice(
          applyStoredState(parsed)
            ? activeCopy.backupImportDone
            : activeCopy.backupImportFail,
        );
      } catch {
        setBackupNotice(activeCopy.backupImportFail);
      }
    },
    [activeCopy.backupImportDone, activeCopy.backupImportFail, applyStoredState],
  );

  const clearSavedData = useCallback(async () => {
    if (!window.confirm(activeCopy.backupClearConfirm)) return;
    await clearStore(PROFILE_STORE_KEY);
    try {
      window.localStorage.removeItem(HEALTH_NOTES_STORAGE_KEY);
    } catch {
      // 이미 없으면 무시한다.
    }
    setLanguage(null);
    setGender(null);
    setAgeBand(70);
    setAgeConfirmed(false);
    setAllergyIds([]);
    setConditionIds([]);
    setHealthNotes([]);
    setChatTurns([]);
    setAnswerCardIndex(0);
    setStoreSavedAt(null);
    setBackupNotice(activeCopy.backupCleared);
  }, [activeCopy.backupClearConfirm, activeCopy.backupCleared]);

  /**
   * 기기에 저장해 둔 프로필과 대화를 되살린다.
   *
   * 어르신이 매번 87개 목록에서 알레르기·질병을 다시 고르게 하면 재방문이 어렵다.
   * 로그인도 서버도 없이 브라우저 안에만 두고, 옛 localStorage 메모도 한 번 옮겨 온다.
   */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const kind = await describeStore();
      const stored = await readStore<StoredState>(PROFILE_STORE_KEY);
      if (cancelled) return;

      setStoreKind(kind);
      if (stored) {
        applyStoredState(stored);
        setStoreSavedAt(typeof stored.savedAt === "number" ? stored.savedAt : null);
      } else {
        // v1 이전에는 음성 메모만 localStorage에 있었다. 한 번만 옮겨 온다.
        const legacy = readLegacyHealthNotes();
        if (legacy.length > 0) setHealthNotes(legacy);
      }
      setStoreReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [applyStoredState]);

  /** 값이 바뀌면 잠시 뒤 한 번만 저장한다(선택마다 곧바로 쓰지 않도록). */
  useEffect(() => {
    if (!storeReady) return;
    const timer = window.setTimeout(() => {
      const snapshot: StoredState = {
        version: 1,
        savedAt: Date.now(),
        profile: {
          language,
          gender,
          ageBand,
          ageConfirmed,
          allergyIds,
          conditionIds,
          healthNotes,
        },
        // 답변 음성은 저장하지 않는다. 용량이 크고 다시 만들 수 있다.
        chatTurns: chatTurns.slice(-MAX_STORED_TURNS),
      };
      void writeStore(PROFILE_STORE_KEY, snapshot).then(() => {
        setStoreSavedAt(snapshot.savedAt);
      });
    }, 500);
    return () => window.clearTimeout(timer);
  }, [
    storeReady,
    language,
    gender,
    ageBand,
    ageConfirmed,
    allergyIds,
    conditionIds,
    healthNotes,
    chatTurns,
  ]);

  const addHealthNote = useCallback((kind: HealthNote["kind"], text: string) => {
    const cleaned = text.trim();
    if (!cleaned) return;
    setHealthNotes((current) => {
      // 같은 문장을 두 번 저장하면 프롬프트만 길어지므로 건너뛴다.
      if (current.some((note) => note.text === cleaned && note.kind === kind)) {
        return current;
      }
      return [
        ...current,
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          kind,
          text: cleaned,
          savedAt: Date.now(),
        },
      ].slice(-MAX_HEALTH_NOTES);
    });
  }, []);

  const removeHealthNote = useCallback((id: string) => {
    setHealthNotes((current) => current.filter((note) => note.id !== id));
  }, []);

  // 첫 진입 안내는 "언어를 고르세요"가 아니라 "무엇을 말하면 되는지"를 읽어 준다.
  useEffect(() => {
    if (!voicePreferenceReady || !autoVoiceGuide || initialTtsPlayed.current) return;
    initialTtsPlayed.current = true;
    queueBrowserNarration(uiCopy["ko-KR"].welcomeVoice, "ko-KR", 450);
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

  const changeNarrationRate = (event: ChangeEvent<HTMLInputElement>) => {
    const next = Number(event.currentTarget.value);
    const nextRate = narrationRateOptions[next].value;
    setNarrationRateIndex(next);
    narrationRateRef.current = nextRate;
    window.localStorage.setItem(NARRATION_RATE_STORAGE_KEY, String(next));

    // 서버 TTS(오디오 태그) 재생 중이면 즉시 반영된다.
    if (activeAudiosRef.current.size > 0) {
      activeAudiosRef.current.forEach((audio) => {
        audio.defaultPlaybackRate = nextRate;
        audio.playbackRate = nextRate;
      });
      return;
    }

    // 브라우저 음성은 재생 중 rate 변경이 반영되지 않으므로 현재 위치에서 다시 읽어준다.
    const state = browserNarrationRef.current;
    if (!state) return;
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    if (!window.speechSynthesis.speaking && !window.speechSynthesis.pending) return;

    if (rateRestartTimerRef.current !== null) {
      window.clearTimeout(rateRestartTimerRef.current);
    }
    rateRestartTimerRef.current = window.setTimeout(() => {
      rateRestartTimerRef.current = null;
      const current = browserNarrationRef.current;
      if (!current) return;
      const restart = () =>
        runBrowserNarration({
          pages: current.pages,
          startPage: current.pageIndex,
          startChunk: current.chunkIndex,
          firstCardIndex: current.firstCardIndex,
          lang: current.lang,
        });

      const voice = pickSpeechVoice(current.lang);
      const serverBlocked = Date.now() < serverTtsBlockedUntilRef.current;
      if (
        serverBlocked ||
        !needsServerNarration(voice, current.lang, narrationRateRef.current)
      ) {
        restart();
        return;
      }
      void speakPagesWithServerTts(
        current.pages,
        current.pageIndex,
        current.firstCardIndex,
        current.lang,
        restart,
      );
    }, 280);
  };

  const replayCurrentGuide = () => {
    const step = getNextStep(language, gender, ageConfirmed);
    queueBrowserNarration(promptCopy[activeLanguage][step], activeLanguage, 20);
  };

  /** 슬라이더를 옮긴 뒤 바로 속도를 확인할 수 있게 한 문장을 읽어준다. */
  const previewNarrationRate = () => {
    stopNarration();
    speakGuideNarration(activeCopy.answerSpeedSample, activeLanguage);
  };

  /**
   * 진행 표시의 단계 이름을 누르면 그 항목까지 화면을 움직이고 포커스도 옮긴다.
   * 화면만 스크롤하면 키보드나 스크린리더 사용자는 위치를 알 수 없다.
   */
  const focusSetupSection = (step: "language" | "gender" | "age") => {
    const target =
      step === "language"
        ? languageSectionRef.current
        : step === "gender"
          ? genderSectionRef.current
          : ageSectionRef.current;
    if (!target) return;

    target.scrollIntoView({ behavior: "smooth", block: "center" });
    // scrollIntoView 가 이미 움직이고 있어 포커스가 화면을 또 끌어당기지 않게 한다.
    target.querySelector("button")?.focus({ preventScroll: true });
  };

  const setupProgressItems = [
    {
      step: "language" as const,
      label: activeCopy.progressLanguage,
      done: Boolean(language),
    },
    {
      step: "gender" as const,
      label: activeCopy.progressGender,
      done: Boolean(gender),
    },
    {
      step: "age" as const,
      label: activeCopy.progressAge,
      done: ageConfirmed,
    },
  ];

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

  const selectAge = (age: number) => {
    const alreadySelected = ageConfirmed && ageBand === age;
    setAgeBand(age);
    setAgeConfirmed(!alreadySelected);
    announceNext(language, gender, !alreadySelected);
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

  const toggleHealthId = (
    id: string,
    setter: React.Dispatch<React.SetStateAction<string[]>>,
  ) => {
    setter((items) =>
      items.includes(id) ? items.filter((value) => value !== id) : [...items, id],
    );
  };

  const stopRecording = () => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
  };

  /**
   * 로컬 Gemma 2 방언 변환 서버(backend/local_dialect/main.py)로 표준어 정규화를 시도한다.
   * 서버가 꺼져 있거나 느리면 원문을 그대로 쓰고, Gemini 쪽 방언 사전이 그다음을 맡는다.
   */
  const normalizeDialectLocally = useCallback(
    async (text: string, lang: Language = activeLanguage) => {
      const dialectUrl = usableDialectApiUrl();
      if (!dialectUrl || !text.trim()) return text;
      if (baseLanguageTag(lang) !== "ko") return text;

      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), 6000);
      try {
        const response = await fetch(`${dialectUrl.replace(/\/$/, "")}/normalize`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
          signal: controller.signal,
        });
        const payload = (await response.json()) as {
          normalized?: string;
          detail?: string;
        };
        if (!response.ok || !payload.normalized?.trim()) {
          console.warn(
            "[SilverLens] 방언 변환 서버 응답을 쓰지 못해 원문을 사용합니다.",
            payload.detail ?? response.status,
          );
          return text;
        }
        const normalized = payload.normalized.trim();
        if (normalized !== text) {
          console.info(`[SilverLens] 방언 변환: "${text}" → "${normalized}"`);
        }
        return normalized;
      } catch (error) {
        console.warn(
          "[SilverLens] 방언 변환 서버에 연결하지 못해 원문을 사용합니다.",
          error,
        );
        return text;
      } finally {
        window.clearTimeout(timer);
      }
    },
    [activeLanguage],
  );

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
      gender?: unknown;
      ageBand?: unknown;
      error?: string;
    };
    if (!response.ok || !payload.text?.trim()) {
      throw new Error(payload.error || "음성을 인식하지 못했습니다.");
    }
    // 서버가 이미 걸러 주지만, 화면 상태에 바로 들어가는 값이라 한 번 더 확인한다.
    const gender =
      payload.gender === "male" || payload.gender === "female"
        ? (payload.gender as Gender)
        : null;
    const ageBand =
      typeof payload.ageBand === "number" && ageChoices.includes(payload.ageBand)
        ? payload.ageBand
        : null;
    return {
      text: payload.text.trim(),
      allergies: uniqueItems(payload.allergies ?? []),
      conditions: uniqueItems(payload.conditions ?? []),
      gender,
      ageBand,
    };
  }, [activeLanguage]);

  /**
   * 음성에서 찾은 프로필 정보를 화면 선택 상태에 실제로 반영한다.
   *
   * 알레르기·질병은 이미 고른 것에 더하기만 한다(음성이 기존 선택을 지우면 위험하다).
   * 성별·나이는 아직 고르지 않았을 때만 채운다. 직접 고른 값을 음성이 덮어쓰면
   * 어르신이 왜 바뀌었는지 알 수 없다.
   * 반환값은 어르신에게 무엇이 등록됐는지 알려 줄 안내 문구다.
   */
  const applyVoiceProfile = (analysis: VoiceAnalysis) => {
    if (analysis.allergies.length > 0) {
      setAllergyIds((current) => uniqueItems([...current, ...analysis.allergies]));
    }
    if (analysis.conditions.length > 0) {
      setConditionIds((current) => uniqueItems([...current, ...analysis.conditions]));
    }
    const pickedGender = Boolean(analysis.gender) && !gender;
    const pickedAge = analysis.ageBand !== null && !ageConfirmed;
    if (pickedGender && analysis.gender) setGender(analysis.gender);
    if (pickedAge && analysis.ageBand !== null) {
      setAgeBand(analysis.ageBand);
      setAgeConfirmed(true);
    }

    const found = analysis.allergies.length + analysis.conditions.length;
    const parts = [
      found > 0
        ? activeCopy.profileVoiceFound
            .replace("{allergies}", String(analysis.allergies.length))
            .replace("{conditions}", String(analysis.conditions.length))
        : activeCopy.profileVoiceEmpty,
    ];
    if (pickedGender) parts.push(activeCopy.voiceFoundGender);
    if (pickedAge) {
      parts.push(
        activeCopy.voiceFoundAge.replace("{age}", String(analysis.ageBand)),
      );
    }
    return { notice: parts.join(" "), changed: found > 0 || pickedGender || pickedAge };
  };

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
      setRecordingError(activeCopy.micPermission);
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
          setProfileVoiceNotice(activeCopy.processingVoice);
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
              /*
               * 대화 화면에서 "나는 알츠하이머가 있고 복숭아 알레르기가 있어" 처럼
               * 건강 정보를 말하는 어르신이 많다. 설정 화면으로 다시 들어가지 않아도
               * 곧바로 내 정보에 반영해 준다. 찾은 게 있을 때만 알린다.
               */
              const applied = applyVoiceProfile(analysis);
              setProfileVoiceNotice(applied.changed ? applied.notice : "");
            } else {
              setShowAllergyInput(false);
              setShowConditionInput(false);
              const applied = applyVoiceProfile(analysis);
              // 목록으로 고를 수 없는 상세 설명("견과류 중에 특히 호두")을 원문 그대로 남긴다.
              addHealthNote(
                context === "allergy"
                  ? "allergy"
                  : context === "condition"
                    ? "condition"
                    : "setup",
                text,
              );
              setProfileVoiceNotice(`${applied.notice} ${activeCopy.noteSaved}`);
            }
        } catch (error) {
          setRecordingError(
            context === "chat"
              ? activeCopy.audioPreviewFail
              : error instanceof Error
                ? error.message
                : activeCopy.transcribeRetry,
          );
          if (context !== "chat") setProfileVoiceNotice("");
        } finally {
          setIsTranscribingVoice(false);
        }
      });
      recorder.start();
      setRecordingContext(context);
    } catch {
      setRecordingError(activeCopy.micPermission);
    }
  };

  /**
   * 설정 화면에서 대화로 돌아간다.
   * 정보 입력은 이제 필수 단계가 아니라 선택이므로 미완성이어도 막지 않는다.
   * 음성 인식이 돌아가는 중에만 잠깐 기다리게 한다.
   */
  const beginChat = () => {
    if (isTranscribingVoice) {
      setProfileVoiceNotice(activeCopy.waitTranscribing);
      return;
    }
    stopNarration();
    setScreen("chat");
  };

  /** 대화 화면에서 정보 입력 화면으로 이동하며 현재 단계를 음성으로 안내한다. */
  const openProfileSetup = () => {
    stopNarration();
    setScreen("setup");
    announceNext();
  };

  const replayWelcome = () => {
    speakGuideNarration(activeCopy.welcomeVoice, activeLanguage);
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

  /** 사진 흐름 시작. 먼저 무엇을 찍는지 고르게 한다. */
  const openPhotoFlow = () => {
    stopNarration();
    setChatError("");
    setIsPhotoZoomOpen(false);
    setPhotoStep("purpose");
  };

  const closePhotoFlow = () => {
    setPhotoStep(null);
    setIsPhotoZoomOpen(false);
  };

  /** 목적을 고르면 안내를 읽어 주고 바로 카메라(파일 선택)를 연다. */
  const choosePhotoPurpose = (purpose: PhotoPurpose, tip: string) => {
    setPhotoPurpose(purpose);
    setPhotoStep(null);
    speakGuideNarration(tip, activeLanguage);
    photoInputRef.current?.click();
  };

  /** 확인 화면에서 다시 찍기. 목적은 그대로 두고 카메라만 다시 연다. */
  const retakePhoto = () => {
    stopNarration();
    setIsPhotoZoomOpen(false);
    photoInputRef.current?.click();
  };

  const handlePhoto = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setChatError(activeCopy.imageOnly);
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setChatError(activeCopy.imageTooLarge);
      return;
    }
    setChatError("");
    setIsPreparingPhoto(true);
    setPhotoStep("review");
    try {
      // 장변을 줄이고 밝기·흔들림을 재는 동안 확인 화면에 "확인 중"을 띄운다.
      const prepared = await preparePhoto(file);
      setPendingImage((previous) => {
        if (previous) URL.revokeObjectURL(previous.url);
        return {
          file: prepared.file,
          url: prepared.url,
          purpose: photoPurpose,
          issues: prepared.processed ? prepared.quality.issues : null,
          width: prepared.width,
          height: prepared.height,
          byteSize: prepared.file.size,
        };
      });
    } finally {
      setIsPreparingPhoto(false);
    }
  };

  /** 확인 화면에서 "이대로 물어보기". 첨부만 확정하고 질문은 아직 보내지 않는다. */
  const acceptPendingPhoto = () => {
    closePhotoFlow();
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
    setPendingImage((previous) => {
      if (previous) URL.revokeObjectURL(previous.url);
      return null;
    });
    setPhotoPurpose(null);
    closePhotoFlow();
  };

  /** overrideText 가 있으면 입력창 내용 대신 그 문장을 보낸다(자주 묻는 질문 버튼). */
  const askGemini = async (overrideText?: string) => {
    const cleaned = (overrideText ?? chatInput).trim();
    const hasMeaningfulText = Boolean(cleaned && /[\p{L}\p{N}]/u.test(cleaned));
    if (!hasMeaningfulText && !pendingAudio && !pendingImage) {
      setChatError(activeCopy.requireInput);
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
      // 글로 쓴 질문도 방언 변환 모델을 거치게 한다(음성 질문은 녹음 직후 이미 통과).
      const normalizedText = cleaned
        ? await normalizeDialectLocally(cleaned, activeLanguage)
        : cleaned;
      const purposeOption = pendingImage
        ? photoPurposeOptions.find((option) => option.id === pendingImage.purpose)
        : undefined;
      const attachmentLabels = [
        ...(pendingAudio ? [`🎙 ${activeCopy.audioLabel} ${formatDuration(pendingAudio.duration)}`] : []),
        ...(pendingImage
          ? [
              purposeOption
                ? `🖼 ${activeCopy.photoOneLabel} · ${activeCopy[purposeOption.labelKey]}`
                : `🖼 ${activeCopy.photoOneLabel}`,
            ]
          : []),
      ];
      const questionLabel =
        cleaned ||
        (pendingAudio && pendingImage
          ? activeCopy.audioPhotoQuestion
          : pendingAudio
            ? activeCopy.audioQuestion
            : activeCopy.photoQuestion);
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: normalizedText,
          audio,
          image,
          // 촬영 목적이 있으면 Vision 지시를 그 목적에 맞게 좁힌다.
          imagePurpose: pendingImage?.purpose ?? undefined,
          profile: {
            language: activeLanguage,
            // 성별을 고르지 않았으면 보내지 않는다(프롬프트가 일반 기준으로 답한다).
            gender: gender ?? undefined,
            ageBand,
            allergies: localizedAllergies,
            conditions: localizedConditions,
            allergyIds,
            conditionIds,
            healthNotes: healthNotes.map((note) => ({
              kind: note.kind,
              text: note.text,
            })),
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
        retryAfterSeconds?: number;
      };
      if (response.status === 429) {
        const seconds = Number(payload.retryAfterSeconds);
        throw new Error(
          Number.isFinite(seconds) && seconds > 0
            ? activeCopy.quotaWait.replace("{seconds}", String(Math.ceil(seconds)))
            : activeCopy.quotaExceeded,
        );
      }
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
      setPendingImage((previous) => {
        if (previous) URL.revokeObjectURL(previous.url);
        return null;
      });
      setPhotoPurpose(null);
      setTranscript("");
      // 서버 TTS가 필요한 설정일 때만 미리 만들어 둔다(기본 속도에서는 호출하지 않음).
      if (serverNarrationNeeded(activeLanguage)) {
        prepareGeminiAnswer(nextTurn.id, narrationPages, activeLanguage);
      }
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
    const about = aboutCopy[activeLanguage];
    const leaveAbout = () => {
      stopNarration();
      setScreen(chatTurns.length > 0 ? "chat" : "setup");
    };

    return (
      <div className="about-root">
        <header className="about-bar">
          <div className="about-bar-inner">
            <a className="about-bar-brand" href="#about-top">
              <span className="about-bar-mark" aria-hidden="true">SL</span>
              SilverLens
            </a>

            <nav className="about-bar-nav" aria-label={activeCopy.menuLabel}>
              <a href="#about-features">{about.navFeatures}</a>
              <a href="#about-guide">{about.navGuide}</a>
              <a href="#about-workflow">{about.navWorkflow}</a>
            </nav>

            <div className="about-bar-actions">
              <div className="about-lang" role="group" aria-label={about.languageLabel}>
                {languages.map((item) => (
                  <button
                    key={item.id}
                    className={
                      activeLanguage === item.id ? "about-lang-item active" : "about-lang-item"
                    }
                    onClick={() => setLanguage(item.id)}
                    aria-pressed={activeLanguage === item.id}
                  >
                    <LanguageFlag id={item.id} />
                    <span className="about-lang-text">{item.label}</span>
                  </button>
                ))}
              </div>

              <button className="about-bar-cta" onClick={leaveAbout}>
                <span aria-hidden="true">←</span>
                {about.backToService}
              </button>
            </div>
          </div>
        </header>

        <main>
          <section className="about-panel about-panel-hero" id="about-top">
            <div className="about-wrap about-hero-inner">
              <p className="about-brand-title">SilverLens</p>
              <p className="about-brand-subtitle">{about.brandSubtitle}</p>
              <h1 className="about-hero-title">
                {about.heroTitle}
                <span className="about-accent">{about.heroTitleAccent}</span>
              </h1>
              <p className="about-hero-description">
                {about.heroDescription.map((line, index) => (
                  <span key={line}>
                    {index > 0 && <br />}
                    {line}
                  </span>
                ))}
              </p>
              <div className="about-hero-actions">
                <button className="about-btn-primary" onClick={leaveAbout}>
                  {about.heroSecondaryCta}
                </button>
                <a className="about-btn-ghost" href="#about-features">
                  <span>{about.heroCta}</span>
                  <span className="about-hero-mini-arrow" aria-hidden="true">↓</span>
                </a>
              </div>
            </div>
          </section>

          <section className="about-panel about-panel-tint" id="about-features">
            <div className="about-wrap">
              <div className="about-section-header">
                <p className="about-section-badge">{about.featuresBadge}</p>
                <h2 className="about-section-title">
                  {about.featuresTitle}
                  <span>{about.featuresTitleAccent}</span>
                </h2>
                <p className="about-section-description">{about.featuresDescription}</p>
              </div>

              <div className="about-features-grid">
                {about.features.map((feature, index) => (
                  <article className="about-feature-card" key={feature.title}>
                    <div className="about-icon-box">{aboutFeatureIcons[index]}</div>
                    <h3>{feature.title}</h3>
                    <p>{feature.text}</p>
                  </article>
                ))}
              </div>

              {/*
                실제 서비스 화면 조각을 소개 페이지 안에 액자처럼 넣어 둔다.
                두 화면의 톤 차이가 "실수"가 아니라 "의도된 대비"로 읽히게 하는 연결 고리다.
              */}
              <aside className="about-preview" aria-label={about.previewTitle}>
                <div className="about-preview-head">
                  <p className="about-preview-badge">{about.previewBadge}</p>
                  <h3>{about.previewTitle}</h3>
                  <p className="about-preview-note">{about.previewDescription}</p>
                </div>

                <div className="about-preview-stage" aria-hidden="true">
                  <div className="about-preview-card">
                    <span className="about-preview-label">{about.previewRiskTitle}</span>
                    <div className="about-preview-risks">
                      <span className="about-chip danger">⛔ {activeCopy.riskDanger}</span>
                      <span className="about-chip caution">⚠ {activeCopy.riskCaution}</span>
                      <span className="about-chip safe">✓ {about.previewRiskSafe}</span>
                    </div>
                  </div>

                  <div className="about-preview-card">
                    <span className="about-preview-label">{about.previewDialectTitle}</span>
                    <p className="about-preview-dialect">
                      <strong>{about.previewDialectFrom}</strong>
                      <span className="about-preview-arrow">→</span>
                      <strong>{about.previewDialectTo}</strong>
                    </p>
                  </div>

                  <div className="about-preview-card about-preview-card-wide">
                    <span className="about-preview-label">{about.previewAnswerTitle}</span>
                    <p className="about-preview-answer">{about.previewAnswerText}</p>
                    <span className="about-preview-mic">{about.previewMic}</span>
                  </div>
                </div>
              </aside>
            </div>
          </section>

          {/*
            어르신이 실제로 무엇을 누르면 되는지 순서대로 보여 주는 구간.
            왼쪽은 설명과 팁, 오른쪽은 실제 화면을 흉내 낸 작은 목업이다.
          */}
          <section className="about-panel" id="about-guide">
            <div className="about-wrap">
              <div className="about-section-header">
                <p className="about-section-badge">{about.guideBadge}</p>
                <h2 className="about-section-title">
                  {about.guideTitle}
                  <span>{about.guideTitleAccent}</span>
                </h2>
                <p className="about-section-description">{about.guideDescription}</p>
              </div>

              <ol className="about-guide-list">
                {about.guideSteps.map((item, index) => (
                  <li className="about-guide-item" key={item.step}>
                    <div className="about-guide-body">
                      <div className="about-guide-head">
                        <div className="about-icon-box">{aboutGuideIcons[index]}</div>
                        <div>
                          <span className="about-step">{item.step}</span>
                          <h3>{item.title}</h3>
                        </div>
                      </div>
                      <div className="about-line" />
                      <p className="about-guide-text">{item.text}</p>
                      <p className="about-guide-tips-label">{about.guideTipsLabel}</p>
                      <ul className="about-guide-tips">
                        {item.tips.map((tip) => (
                          <li key={tip}>{tip}</li>
                        ))}
                      </ul>
                    </div>
                    <AboutGuideMock index={index} step={item} />
                  </li>
                ))}
              </ol>

              <div className="about-guide-cta">
                <button className="about-btn-primary" onClick={leaveAbout}>
                  {about.guideCta}
                </button>
              </div>
            </div>
          </section>

          <section className="about-panel about-panel-tint" id="about-workflow">
            <div className="about-wrap">
              <div className="about-section-header">
                <p className="about-section-badge">{about.workflowBadge}</p>
                <h2 className="about-section-title">
                  {about.workflowTitle}
                  <span>{about.workflowTitleAccent}</span>
                </h2>
                <p className="about-section-description">{about.workflowDescription}</p>
              </div>

              <div className="about-workflow-grid">
                {about.steps.map((item, index) => (
                  <article className="about-workflow-card" key={item.step}>
                    <div className="about-icon-box">{aboutStepIcons[index]}</div>
                    <span className="about-step">{item.step}</span>
                    <h3>{item.title}</h3>
                    <div className="about-line" />
                    <p>{item.text}</p>
                  </article>
                ))}
              </div>
            </div>
          </section>

          <section className="about-panel about-panel-cta">
            <div className="about-wrap about-cta-inner">
              <h2>{about.heroTitleAccent}</h2>
              <p>{about.brandSubtitle}</p>
              <button className="about-btn-primary about-btn-lg" onClick={leaveAbout}>
                {about.heroSecondaryCta}
              </button>
            </div>
          </section>

          {/*
            착지 구간. 다크 CTA에서 서비스 화면 배경색까지 화면 전체 폭으로 넘어가며
            상단만 크게 둥글려 "다음 화면이 올라온다"처럼 읽히게 한다.
          */}
          <footer className="about-sitefoot">
            <div className="about-wrap about-sitefoot-inner">
              <div className="about-sitefoot-top">
                  <a
                    className="about-github"
                    href={GITHUB_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <svg viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">
                      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.07-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.4 7.4 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.15 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A7.995 7.995 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
                    </svg>
                    {about.githubCta}
                  </a>
                </div>

                <div className="about-team">
                  <p className="about-team-title">{about.teamTitle}</p>
                  <ul>
                    {teamMembers.map((member) => (
                      <li key={member.name}>
                        <span>{member.roles[activeLanguage]}</span>
                        <strong>{member.name}</strong>
                      </li>
                    ))}
                  </ul>
                </div>

              <p className="about-foot">{about.footer}</p>
            </div>
          </footer>
        </main>
      </div>
    );
  }

  if (screen === "chat") {
    const isRecording = recordingContext === "chat";
    // 등록 질병에 맞는 버튼을 하나만 덧붙인다. 여러 개면 화면이 길어진다.
    const conditionAsk = conditionQuickAsks.find((item) =>
      item.conditionIds.some((id) => conditionIds.includes(id)),
    );
    const visibleQuickAsks: QuickAsk[] = conditionAsk
      ? [...quickAsks, conditionAsk]
      : quickAsks;
    const pickQuickAsk = (item: QuickAsk) => {
      if (item.action === "photo") {
        openPhotoFlow();
        return;
      }
      const question = item.question?.[activeLanguage];
      if (question) void askGemini(question);
    };
    // 같은 답변 안에서 다음 장이 남아 있는지. 다른 대화로 넘어가는 것과 구분한다.
    const hasNextPageInTurn = Boolean(
      activeAnswerCard &&
        activeAnswerCard.pageIndex + 1 < activeAnswerCard.pageCount,
    );
    // 음성 인식 결과가 들어오면 글 입력창을 자동으로 펼쳐 확인·수정할 수 있게 한다.
    const isTextInputVisible = showTextInput || chatInput.trim().length > 0;
    const hasProfileInfo =
      ageConfirmed || allergyIds.length > 0 || conditionIds.length > 0;
    const pendingPhotoPurpose = pendingImage
      ? photoPurposeOptions.find((option) => option.id === pendingImage.purpose)
      : undefined;
    // 검사를 못 했으면(null) 직접 확인해 달라고 하고, 문제가 없으면 잘 찍혔다고 알린다.
    const photoQualityMessages: string[] = !pendingImage
      ? []
      : pendingImage.issues === null
        ? [activeCopy.photoQualitySkipped]
        : pendingImage.issues.length === 0
          ? [activeCopy.photoQualityOk]
          : pendingImage.issues.map((issue) =>
              issue === "dark"
                ? activeCopy.photoQualityDark
                : issue === "bright"
                  ? activeCopy.photoQualityBright
                  : activeCopy.photoQualityBlurry,
            );
    const hasPhotoQualityProblem = Boolean(
      pendingImage?.issues && pendingImage.issues.length > 0,
    );
    return (
      <main className="app-shell">
        <Sidebar active="chat" onNavigate={setScreen} copy={activeCopy} />
        <section className="chat-screen">
          <header className="chat-header">
            {/* 정보를 아직 안 넣었으면 버튼을 강조해 눈에 띄게 한다. */}
            <button
              className={hasProfileInfo ? "back-button" : "back-button highlight"}
              onClick={openProfileSetup}
            >
              <strong>{activeCopy.openProfile}</strong>
              {!hasProfileInfo && <small>{activeCopy.openProfileHelp}</small>}
            </button>
            <div className="profile-pills">
              {/*
                평소에는 현재 언어 하나만 알약으로 보이고, 누르면 옆으로 늘어나
                세 언어가 나온다. 세 개를 늘 펼쳐 두면 헤더가 넘쳐 폰에서 잘렸다.
                버튼 셋을 항상 그려 두고 CSS 로 접기 때문에 늘어나는 움직임이 부드럽다.
              */}
              <div
                className={isLanguageOpen ? "profile-lang open" : "profile-lang"}
                role="group"
                aria-label={activeCopy.languageLegend}
              >
                {languages.map((item) => {
                  const isCurrent = activeLanguage === item.id;
                  const hidden = !isLanguageOpen && !isCurrent;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className={isCurrent ? "profile-lang-item active" : "profile-lang-item"}
                      onClick={() => {
                        if (!isLanguageOpen) {
                          setIsLanguageOpen(true);
                          return;
                        }
                        setLanguage(item.id);
                        setIsLanguageOpen(false);
                      }}
                      aria-pressed={isCurrent}
                      aria-expanded={isCurrent ? isLanguageOpen : undefined}
                      // 접혀 있는 동안에는 탭 이동에서 빼 둔다.
                      tabIndex={hidden ? -1 : 0}
                    >
                      <LanguageFlag id={item.id} />
                      <span>{item.label}</span>
                      <span className="profile-lang-caret" aria-hidden="true">
                        ▾
                      </span>
                    </button>
                  );
                })}
              </div>
              {ageConfirmed && <span>● {ageBand}{activeCopy.profileAge}</span>}
              {allergyIds.length + conditionIds.length > 0 && (
                <span>
                  ♡ {activeCopy.allergyTitle} {allergyIds.length} · {activeCopy.conditionTitle}{" "}
                  {conditionIds.length}
                </span>
              )}
            </div>
          </header>

          <h1>{activeCopy.headline}</h1>

          {/* 첫 진입에서 무엇을 하면 되는지 한눈에 알려 주는 안내. */}
          {answerCards.length === 0 && (
            <section className="chat-welcome" aria-label={activeCopy.welcomeTitle}>
              <div>
                <strong>{activeCopy.welcomeTitle}</strong>
                <p>{activeCopy.welcomeBody}</p>
              </div>
              <button type="button" className="chat-welcome-replay" onClick={replayWelcome}>
                {activeCopy.welcomeReplay}
              </button>
            </section>
          )}

          <section className="answer-section" aria-live="polite">
            {/*
              첫 화면에서 설정 화면으로 넘어가지 않고도 기본 정보를 넣을 수 있게 한다.
              말로 한 번에 말하거나, 성별·나이 버튼을 바로 눌러도 된다.
              답변이 하나라도 생기면 감춰서 답변 볼 자리를 넓힌다.
            */}
            {answerCards.length === 0 && (
              <div className="chat-quick-profile">
                <div className="chat-quick-profile-head">
                  <strong>{activeCopy.quickProfileTitle}</strong>
                  <small>
                    {hasProfileInfo
                      ? activeCopy.quickProfileDone
                      : activeCopy.quickProfileHelp}
                  </small>
                </div>

                <button
                  type="button"
                  className={
                    recordingContext === "setup"
                      ? "chat-quick-speak recording"
                      : "chat-quick-speak"
                  }
                  onClick={() => toggleRecording("setup")}
                  disabled={isTranscribingVoice}
                  aria-pressed={recordingContext === "setup"}
                >
                  <span aria-hidden="true">
                    {recordingContext === "setup" ? "●" : "🎙️"}
                  </span>
                  <span>
                    <strong>
                      {recordingContext === "setup"
                        ? activeCopy.recording
                        : activeCopy.quickProfileSpeak}
                    </strong>
                    <small>
                      {recordingContext === "setup"
                        ? activeCopy.recordingHelp
                        : activeCopy.quickProfileSpeakHelp}
                    </small>
                  </span>
                </button>

                <div className="chat-quick-row" role="group" aria-label={activeCopy.genderLegend}>
                  <span className="chat-quick-legend">{activeCopy.genderLegend}</span>
                  <div className="chat-quick-choices">
                    {(["male", "female"] as Gender[]).map((id) => (
                      <button
                        key={id}
                        type="button"
                        className={gender === id ? "chat-quick-chip selected" : "chat-quick-chip"}
                        onClick={() => toggleGender(id)}
                        aria-pressed={gender === id}
                      >
                        {id === "male" ? activeCopy.male : activeCopy.female}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="chat-quick-row" role="group" aria-label={activeCopy.ageLegend}>
                  <span className="chat-quick-legend">{activeCopy.ageLegend}</span>
                  <div className="chat-quick-choices">
                    {ageChoices.map((age) => (
                      <button
                        key={age}
                        type="button"
                        className={
                          ageConfirmed && ageBand === age
                            ? "chat-quick-chip selected"
                            : "chat-quick-chip"
                        }
                        onClick={() => selectAge(age)}
                        aria-pressed={ageConfirmed && ageBand === age}
                      >
                        {age}
                        {activeCopy.years}
                      </button>
                    ))}
                  </div>
                </div>

                <button type="button" className="chat-quick-more" onClick={openProfileSetup}>
                  {activeCopy.quickProfileMore}
                </button>
              </div>
            )}

            <div className="answer-heading">
              <span className="answer-label">{activeCopy.answerLabel}</span>
              <span className={isLoadingAnswer ? "answer-state waiting" : "answer-state"}>
                {isLoadingAnswer
                  ? activeCopy.answerLoading
                  : activeAnswerCard
                    ? `${activeCopy.conversation} ${activeAnswerCard.turnIndex + 1} · ${activeCopy.answer} ${
                        activeAnswerCard.pageIndex + 1
                      }/${activeAnswerCard.pageCount}`
                    : activeCopy.answerWaiting}
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
                aria-label={activeCopy.prevAnswer}
              >
                ‹
              </button>
              <article className="answer-card">
                {activeAnswerCard ? (
                  <>
                    <div className="answer-question">
                      <span>{activeCopy.questionBadge}</span>
                      <strong>{activeAnswerCard.question}</strong>
                    </div>
                    {/*
                      카드 안 "2장 중 1장" 배지는 없앴다.
                      헤더의 "대화 1 · 답변 1/2" 와 같은 말이라 자리만 차지했다.
                      다음 장 안내는 카드 아래 버튼이 맡는다.
                    */}
                    {activeAnswerCard.warningMessage && (
                      <div
                        className={`answer-warning ${activeAnswerCard.riskLevel}`}
                        role="alert"
                      >
                        <span className="warning-mark" aria-hidden="true">
                          {activeAnswerCard.riskLevel === "danger" ? "⛔" : "⚠"}
                        </span>
                        <div>
                          <strong>
                            <span className="risk-chip">
                              {activeAnswerCard.riskLevel === "danger"
                                ? activeCopy.riskDanger
                                : activeCopy.riskCaution}
                            </span>
                            {activeAnswerCard.riskLevel === "danger"
                              ? activeCopy.foodWarning
                              : activeCopy.foodCheck}
                          </strong>
                          <p>{activeAnswerCard.warningMessage}</p>
                        </div>
                      </div>
                    )}
                    {activeAnswerCard.attachmentLabels.length > 0 && (
                      <div className="answer-attachments" aria-label={activeCopy.attachmentLabel}>
                        {activeAnswerCard.attachmentLabels.map((label) => (
                          <span key={label}>{label}</span>
                        ))}
                      </div>
                    )}
                    <div className="answer-markdown">
                      <ReactMarkdown>{activeAnswerCard.content}</ReactMarkdown>
                    </div>
                    {/*
                      답변이 여러 장이면 어르신이 첫 장만 보고 끝낼 수 있다.
                      카드 안에서 다음 장이 있다는 것과 누르는 곳을 분명히 알린다.
                    */}
                    {activeAnswerCard.pageCount > 1 &&
                      (hasNextPageInTurn ? (
                        <button
                          type="button"
                          className="answer-next-page"
                          onClick={() => moveAnswerCard(1)}
                        >
                          <span className="answer-next-page-text">
                            <strong>{activeCopy.nextPagePrompt}</strong>
                            <small>
                              {activeCopy.pageBadge
                                .replace("{current}", String(activeAnswerCard.pageIndex + 2))
                                .replace("{total}", String(activeAnswerCard.pageCount))}
                            </small>
                          </span>
                          <span className="answer-next-page-arrow" aria-hidden="true">
                            →
                          </span>
                        </button>
                      ) : (
                        <p className="answer-last-page">{activeCopy.lastPageNotice}</p>
                      ))}
                  </>
                ) : (
                  <div className="answer-placeholder">
                    <strong>{activeCopy.emptyAnswerTitle}</strong>
                    <p>
                      {activeCopy.emptyAnswerHelp}
                    </p>
                    {/* 빈 입력창 앞에서 막히지 않도록 바로 누를 수 있는 예시를 둔다. */}
                    <p className="quick-asks-title">{activeCopy.quickAskTitle}</p>
                    <QuickAskButtons
                      items={visibleQuickAsks}
                      language={activeLanguage}
                      disabled={isLoadingAnswer}
                      onPick={pickQuickAsk}
                      variant="large"
                    />
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
                aria-label={activeCopy.nextAnswer}
              >
                ›
              </button>
            </div>

            <div className="answer-history-footer">
              {/* 작은 글자도 눌러서 답변을 넘기고 되돌릴 수 있게 한다. */}
              <button
                type="button"
                className="answer-history-move"
                onClick={() => moveAnswerCard(-1)}
                disabled={!activeAnswerCard || visibleAnswerCardIndex === 0}
              >
                {activeCopy.previousCards}
              </button>
              <div className="answer-dots" aria-label={activeCopy.cardSelector}>
                {answerCards.map((item, index) => (
                  <button
                    key={item.id}
                    className={index === visibleAnswerCardIndex ? "active" : ""}
                    onClick={() => {
                      stopNarration();
                      setAnswerCardIndex(index);
                    }}
                    aria-label={`${activeCopy.conversation} ${item.turnIndex + 1} · ${activeCopy.answer} ${item.pageIndex + 1}`}
                  />
                ))}
              </div>
              <button
                type="button"
                className="answer-history-move"
                onClick={() => moveAnswerCard(1)}
                disabled={
                  !activeAnswerCard ||
                  visibleAnswerCardIndex === answerCards.length - 1
                }
              >
                {activeCopy.nextCards}
              </button>
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
                ? activeCopy.stopReplay
                : activeAnswerCard &&
                    narrationStatus[activeAnswerCard.turnId] === "preparing"
                  ? activeCopy.preparingReplay
                  : activeAnswerCard &&
                      narrationStatus[activeAnswerCard.turnId] === "ready"
                    ? activeCopy.readyReplay
                    : activeCopy.replayAnswer}
            </button>
          </section>

          <section className="question-composer" aria-label={activeCopy.questionArea}>
            {/* 첫 답변 뒤에도 예시를 쓸 수 있게, 접이식으로 짧게 둔다. */}
            {answerCards.length > 0 && (
              <details className="quick-asks-fold">
                <summary>{activeCopy.quickAskTitle}</summary>
                <QuickAskButtons
                  items={visibleQuickAsks}
                  language={activeLanguage}
                  disabled={isLoadingAnswer}
                  onPick={pickQuickAsk}
                  variant="compact"
                />
              </details>
            )}

            <button
              className={isRecording ? "mic-primary recording" : "mic-primary"}
              onClick={() => toggleRecording("chat")}
              aria-pressed={isRecording}
            >
              <span className="mic-icon" aria-hidden="true">{isRecording ? "●" : "🎙️"}</span>
              <strong>{isRecording ? activeCopy.recording : activeCopy.voiceRecord}</strong>
              <small>{isRecording ? activeCopy.recordingHelp : activeCopy.voiceRecordHelp}</small>
            </button>

            <div className="composer-secondary">
              <button className="composer-tool" onClick={openPhotoFlow}>
                <span aria-hidden="true">📷</span>
                <strong>{activeCopy.uploadPhoto}</strong>
              </button>
              <input
                ref={photoInputRef}
                className="visually-hidden"
                type="file"
                accept="image/png,image/jpeg,image/webp,image/heic,image/heif"
                capture="environment"
                onChange={handlePhoto}
                aria-label={activeCopy.uploadPhoto}
              />
              <button
                className={isTextInputVisible ? "composer-tool active" : "composer-tool"}
                onClick={() => setShowTextInput((value) => !value)}
                aria-expanded={isTextInputVisible}
                aria-controls="chat-question"
              >
                <span aria-hidden="true">⌨</span>
                <strong>{activeCopy.writeText}</strong>
              </button>
            </div>

            {isTextInputVisible && (
              <div className="composer-text">
                <label htmlFor="chat-question">{activeCopy.textQuestion}</label>
                <textarea
                  id="chat-question"
                  value={chatInput}
                  onChange={(event) => setChatInput(event.target.value)}
                  placeholder={activeCopy.questionPlaceholder}
                  maxLength={1000}
                  rows={3}
                />
              </div>
            )}

            {(pendingAudio || pendingImage) && (
              <div className="pending-attachments" aria-label={activeCopy.pendingTitle}>
                <strong>{activeCopy.pendingTitle}</strong>
                <div className="attachment-list">
                  {pendingAudio && (
                    <div className="attachment-chip">
                      <span className="attachment-icon">🎙️</span>
                      <span>
                        <strong>{activeCopy.audioAttached}</strong>
                        <small>{formatDuration(pendingAudio.duration)} · 보내기 전</small>
                      </span>
                      <button onClick={clearPendingAudio} aria-label={activeCopy.audioAttached}>×</button>
                    </div>
                  )}
                  {pendingImage && (
                    <div className="attachment-chip">
                      <button
                        type="button"
                        className="attachment-thumb"
                        onClick={() => {
                          setPhotoStep("review");
                          setIsPhotoZoomOpen(false);
                        }}
                        aria-label={activeCopy.photoZoomOpen}
                      >
                        {/* blob URL 은 이미지 최적화를 거칠 수 없어 img 를 그대로 쓴다. */}
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={pendingImage.url} alt="" />
                      </button>
                      <span>
                        <strong>{activeCopy.photoAttached}</strong>
                        <small>
                          {pendingPhotoPurpose
                            ? activeCopy[pendingPhotoPurpose.labelKey]
                            : pendingImage.file.name}
                        </small>
                      </span>
                      <button onClick={clearPendingImage} aria-label={activeCopy.photoAttached}>×</button>
                    </div>
                  )}
                </div>
                {transcript && <p>{activeCopy.transcript}: {transcript}</p>}
                <p>{activeCopy.sendPendingHelp}</p>
              </div>
            )}

            {/* 말씀에서 건강 정보를 찾아 내 정보에 넣었으면 조용히 넘기지 않고 알린다. */}
            {profileVoiceNotice && (
              <p className="profile-voice-notice" role="status">
                {profileVoiceNotice}
              </p>
            )}

            <button
              className="send-question"
              onClick={() => askGemini()}
              disabled={
                isLoadingAnswer ||
                (!chatInput.trim() && !pendingAudio && !pendingImage)
              }
            >
              <span aria-hidden="true">➤</span>
              <strong>{isLoadingAnswer ? activeCopy.sendingQuestion : activeCopy.sendQuestion}</strong>
              <small>{activeCopy.sendHelp}</small>
            </button>
          </section>

          {chatError && <p className="error-message" role="alert">{chatError}</p>}
          {recordingError && <p className="error-message" role="alert">{recordingError}</p>}
          <p className="medical-note">
            🛡 {activeCopy.medicalNote}
          </p>

          {/* 1단계: 무엇을 찍는지 고른다. 고르면 안내를 읽어 주고 카메라가 바로 열린다. */}
          {photoStep === "purpose" && (
            <div className="photo-sheet" role="dialog" aria-modal="true" aria-label={activeCopy.photoPurposeTitle}>
              <div className="photo-sheet-panel">
                <h2>{activeCopy.photoPurposeTitle}</h2>
                <p className="photo-sheet-help">{activeCopy.photoPurposeHelp}</p>
                <div className="photo-purpose-list">
                  {photoPurposeOptions.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      className="photo-purpose"
                      onClick={() =>
                        choosePhotoPurpose(option.id, activeCopy[option.tipKey])
                      }
                    >
                      <span className="photo-purpose-icon" aria-hidden="true">{option.icon}</span>
                      <span className="photo-purpose-text">
                        <strong>{activeCopy[option.labelKey]}</strong>
                        <small>{activeCopy[option.tipKey]}</small>
                      </span>
                    </button>
                  ))}
                </div>
                <button type="button" className="photo-sheet-cancel" onClick={closePhotoFlow}>
                  {activeCopy.photoPurposeCancel}
                </button>
              </div>
            </div>
          )}

          {/* 2단계: 찍은 사진을 크게 보여 주고 밝기·흔들림 판정을 알려 준다. */}
          {photoStep === "review" && (
            <div className="photo-sheet" role="dialog" aria-modal="true" aria-label={activeCopy.photoReviewTitle}>
              <div className="photo-sheet-panel">
                <h2>{activeCopy.photoReviewTitle}</h2>
                {isPreparingPhoto || !pendingImage ? (
                  <p className="photo-sheet-help" role="status">{activeCopy.photoPreparing}</p>
                ) : (
                  <>
                    <button
                      type="button"
                      className="photo-review-frame"
                      onClick={() => setIsPhotoZoomOpen(true)}
                      aria-label={activeCopy.photoZoomOpen}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={pendingImage.url} alt={activeCopy.photoReviewTitle} />
                      <span className="photo-review-zoom" aria-hidden="true">
                        🔍 {activeCopy.photoZoomOpen}
                      </span>
                    </button>
                    <ul
                      className={
                        hasPhotoQualityProblem
                          ? "photo-quality warn"
                          : "photo-quality"
                      }
                      aria-live="polite"
                    >
                      {photoQualityMessages.map((text) => (
                        <li key={text}>{text}</li>
                      ))}
                    </ul>
                    <p className="photo-sheet-help">{activeCopy.photoReviewHelp}</p>
                    {pendingImage.width > 0 && (
                      <p className="photo-review-meta">
                        {activeCopy.photoSizeNote}: {pendingImage.width}×{pendingImage.height} ·{" "}
                        {Math.max(1, Math.round(pendingImage.byteSize / 1024))}KB
                      </p>
                    )}
                    <div className="photo-review-actions">
                      <button type="button" className="photo-retake" onClick={retakePhoto}>
                        📷 {activeCopy.photoRetake}
                      </button>
                      <button type="button" className="photo-accept" onClick={acceptPendingPhoto}>
                        ✓ {activeCopy.photoUseIt}
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {/* 확대 보기: 작은 글자를 어르신이 직접 확인할 수 있게 화면 전체로 띄운다. */}
          {isPhotoZoomOpen && pendingImage && (
            <div className="photo-zoom" role="dialog" aria-modal="true" aria-label={activeCopy.photoZoomOpen}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={pendingImage.url} alt={activeCopy.photoZoomOpen} />
              <button type="button" className="photo-zoom-close" onClick={() => setIsPhotoZoomOpen(false)}>
                ✕ {activeCopy.photoZoomClose}
              </button>
            </div>
          )}
        </section>
      </main>
    );
  }

  const setupRecording = recordingContext === "setup";

  return (
    <main className="app-shell">
      <Sidebar active="setup" onNavigate={setScreen} copy={activeCopy} />
      <section className="setup-screen">
        {/* 세 단계 이름을 그대로 두고, 누르면 해당 항목으로 화면과 포커스를 옮긴다. */}
        <nav className="setup-progress" aria-label={promptCopy[activeLanguage][nextStep]}>
          {setupProgressItems.map((item) => (
            <button
              key={item.step}
              type="button"
              className={item.done ? "done" : nextStep === item.step ? "current" : ""}
              onClick={() => focusSetupSection(item.step)}
              aria-current={nextStep === item.step ? "step" : undefined}
            >
              {item.label}
              {item.done && (
                <span className="setup-progress-check" aria-hidden="true">✓</span>
              )}
            </button>
          ))}
        </nav>

        <button
          className={autoVoiceGuide ? "auto-tts enabled" : "auto-tts disabled"}
          onClick={toggleAutoVoiceGuide}
          aria-pressed={autoVoiceGuide}
        >
          <span aria-hidden="true">{autoVoiceGuide ? "🔊" : "🔇"}</span>
          <span>
            <strong>{activeCopy.autoVoice} {autoVoiceGuide ? activeCopy.on : activeCopy.off}</strong>
            <small>{autoVoiceGuide ? activeCopy.autoVoiceHelpOn : activeCopy.autoVoiceHelpOff}</small>
          </span>
          <em aria-hidden="true">{autoVoiceGuide ? "ON" : "OFF"}</em>
        </button>

        <section className="speed-control" aria-label={activeCopy.answerSpeed}>
          <div>
            <strong>{activeCopy.answerSpeed}</strong>
            <span>{narrationRateLabel}</span>
          </div>
          <input
            type="range"
            min="0"
            max="4"
            step="1"
            value={narrationRateIndex}
            onChange={changeNarrationRate}
            aria-valuetext={narrationRateLabel}
          />
          <button className="speed-preview" onClick={previewNarrationRate}>
            {activeCopy.answerSpeedPreview}
          </button>
          <small>
            {voiceRateMode === "browser-limited"
              ? activeCopy.answerSpeedLimited
              : activeCopy.answerSpeedHelp}
          </small>
        </section>

        <fieldset className="form-section" ref={languageSectionRef}>
          <legend>{activeCopy.languageLegend}</legend>
          <div className="language-grid">
            {languages.map((item) => (
              <button
                key={item.id}
                className={language === item.id ? "language-button selected" : "language-button"}
                onClick={() => toggleLanguage(item.id)}
                aria-pressed={language === item.id}
              >
                <LanguageFlag id={item.id} />
                <span>{item.label}</span>
                {language === item.id && <span className="selection-check">✓</span>}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="form-section" ref={genderSectionRef}>
          <legend>{activeCopy.genderLegend}</legend>
          <div className="gender-grid">
            <button
              className={gender === "male" ? "gender-button male selected" : "gender-button male"}
              onClick={() => toggleGender("male")}
              aria-pressed={gender === "male"}
            >
              <span aria-hidden="true">♟</span>
              <strong>{activeCopy.male}</strong>
              {gender === "male" && <span className="selection-check">✓</span>}
            </button>
            <button
              className={gender === "female" ? "gender-button female selected" : "gender-button female"}
              onClick={() => toggleGender("female")}
              aria-pressed={gender === "female"}
            >
              <span aria-hidden="true">♟</span>
              <strong>{activeCopy.female}</strong>
              {gender === "female" && <span className="selection-check">✓</span>}
            </button>
          </div>
        </fieldset>

        <fieldset className="form-section age-section" ref={ageSectionRef}>
          <legend>{activeCopy.ageLegend}</legend>
          <div className="age-grid" role="group" aria-label={activeCopy.ageLegend}>
            {ageChoices.map((age) => {
              const selected = ageConfirmed && ageBand === age;
              const isLast = age === ageChoices[ageChoices.length - 1];
              return (
                <button
                  key={age}
                  className={selected ? "age-option selected" : "age-option"}
                  onClick={() => selectAge(age)}
                  aria-pressed={selected}
                >
                  <strong>
                    {age}
                    {activeCopy.years}
                  </strong>
                  <small>
                    {age === ageChoices[0]
                      ? // "40대 이하"는 41~49세가 빠진 것처럼 보이므로 경계 나이를 적는다.
                        activeCopy.ageUnder.replace("{age}", String(age + 9))
                      : isLast
                        ? activeCopy.ageOver.replace("{age}", String(age))
                        : `${age} ~ ${age + 9}`}
                  </small>
                  {selected && <span className="selection-check">✓</span>}
                </button>
              );
            })}
          </div>
          <p className="age-note">
            {ageConfirmed
              ? `${ageBand}${activeCopy.years} ✓`
              : activeCopy.ageHelp}
          </p>
        </fieldset>

        <div className="health-grid">
          <HealthPickerCard
            kind="allergy"
            title={activeCopy.allergyTitle}
            help={activeCopy.allergyHelp}
            copy={activeCopy}
            language={activeLanguage}
            datalistId="allergy-health-options"
            inputLabel={activeCopy.allergyTitle}
            options={allergyOptions}
            groups={allergyGroups}
            selectedIds={allergyIds}
            open={showAllergyInput}
            onToggleOpen={() => setShowAllergyInput((value) => !value)}
            onToggleId={(id) => toggleHealthId(id, setAllergyIds)}
            onClear={() => setAllergyIds([])}
            onRemoveId={(id) =>
              setAllergyIds((items) => items.filter((value) => value !== id))
            }
            onAddTag={(event) => addHealthTag(event, "allergy", setAllergyIds)}
            isRecording={recordingContext === "allergy"}
            onRecord={() => toggleRecording("allergy")}
            recordDisabled={isTranscribingVoice}
          />

          <HealthPickerCard
            kind="condition"
            title={activeCopy.conditionTitle}
            help={activeCopy.conditionHelp}
            copy={activeCopy}
            language={activeLanguage}
            datalistId="condition-health-options"
            inputLabel={activeCopy.conditionTitle}
            options={conditionOptions}
            groups={conditionGroups}
            selectedIds={conditionIds}
            open={showConditionInput}
            onToggleOpen={() => setShowConditionInput((value) => !value)}
            onToggleId={(id) => toggleHealthId(id, setConditionIds)}
            onClear={() => setConditionIds([])}
            onRemoveId={(id) =>
              setConditionIds((items) => items.filter((value) => value !== id))
            }
            onAddTag={(event) => addHealthTag(event, "condition", setConditionIds)}
            isRecording={recordingContext === "condition"}
            onRecord={() => toggleRecording("condition")}
            recordDisabled={isTranscribingVoice}
          />
        </div>
        <p className="health-language-note">
          {activeCopy.healthLanguageNote}
        </p>

        <section className="health-notes" aria-label={activeCopy.notesTitle}>
          <div className="health-notes-head">
            <strong>{activeCopy.notesTitle}</strong>
            <small>{activeCopy.notesHelp}</small>
          </div>
          {healthNotes.length === 0 ? (
            <p className="health-notes-empty">
              {activeCopy.notesEmpty}
              <span>{activeCopy.notesExample}</span>
            </p>
          ) : (
            <ul>
              {healthNotes.map((note) => (
                <li key={note.id}>
                  <span className={`health-note-kind ${note.kind}`}>
                    {note.kind === "allergy"
                      ? activeCopy.noteKindAllergy
                      : note.kind === "condition"
                        ? activeCopy.noteKindCondition
                        : activeCopy.noteKindSetup}
                  </span>
                  <p>{note.text}</p>
                  <button
                    type="button"
                    onClick={() => removeHealthNote(note.id)}
                    aria-label={activeCopy.noteRemove}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/*
          기기 저장 안내와 백업.
          로그인·서버 없이 이 기기에만 두므로, 기기를 바꿀 때는 파일로 옮긴다.
        */}
        <section className="data-backup" aria-label={activeCopy.backupTitle}>
          <div className="data-backup-head">
            <strong>{activeCopy.backupTitle}</strong>
            <small>
              {storeKind === "none"
                ? activeCopy.backupStoreNone
                : storeKind === "localstorage"
                  ? activeCopy.backupStoreLocal
                  : activeCopy.backupHelp}
            </small>
            <small className="data-backup-time">
              {storeSavedAt
                ? activeCopy.backupSavedAt.replace(
                    "{time}",
                    new Date(storeSavedAt).toLocaleString(activeLanguage),
                  )
                : activeCopy.backupNever}
            </small>
          </div>
          <div className="data-backup-actions">
            <button type="button" onClick={exportBackup}>
              {activeCopy.backupExport}
            </button>
            <button type="button" onClick={() => backupInputRef.current?.click()}>
              {activeCopy.backupImport}
            </button>
            <input
              ref={backupInputRef}
              className="visually-hidden"
              type="file"
              accept="application/json,.json"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void importBackup(file);
                event.target.value = "";
              }}
              aria-label={activeCopy.backupImport}
            />
            <button type="button" className="danger" onClick={() => void clearSavedData()}>
              {activeCopy.backupClear}
            </button>
          </div>
          {backupNotice && (
            <p className="data-backup-notice" role="status">
              {backupNotice}
            </p>
          )}
        </section>

        <div className="voice-row">
          <button
            className={setupRecording ? "voice-control recording" : "voice-control"}
            onClick={() => toggleRecording("setup")}
          >
            <span>{setupRecording ? "●" : "🎙️"}</span>
            <div>
              <strong>{setupRecording ? activeCopy.recording : activeCopy.voiceProfile}</strong>
              <small>{setupRecording ? activeCopy.recordingHelp : activeCopy.voiceProfileHelp}</small>
            </div>
          </button>
          <button className="replay-control" onClick={replayCurrentGuide}>
            <span>🔊</span>
            <div>
              <strong>{activeCopy.replayGuide}</strong>
              <small>{activeCopy.replayGuideHelp}</small>
            </div>
          </button>
        </div>

        {recordedUrl && (
          <div className="saved-recording compact">
            <span>✓ {activeCopy.savedRecording}</span>
            <audio controls src={recordedUrl}>
              <track kind="captions" />
            </audio>
          </div>
        )}
        {transcript && <p className="transcript-box">{activeCopy.transcript}: {transcript}</p>}
        {profileVoiceNotice && (
          <p className="profile-voice-notice" role="status">{profileVoiceNotice}</p>
        )}
        {recordingError && <p className="error-message" role="alert">{recordingError}</p>}

        {/*
          정보 입력은 선택이므로 미완성이어도 항상 대화로 돌아갈 수 있다.
          음성 인식이 진행 중일 때만 잠시 막는다.
        */}
        <button
          className={isTranscribingVoice ? "start-button disabled" : "start-button"}
          onClick={beginChat}
          aria-disabled={isTranscribingVoice}
        >
          <span>{activeCopy.profileDone}</span>
          <span aria-hidden="true">›</span>
        </button>
      </section>
    </main>
  );
}
