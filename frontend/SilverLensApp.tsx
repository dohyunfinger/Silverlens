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
type PendingImage = {
  file: File;
  url: string;
};
type VoiceAnalysis = {
  text: string;
  allergies: string[];
  conditions: string[];
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
  flag: string;
  label: string;
  tts: string;
}> = [
  { id: "ko-KR", flag: "🇰🇷", label: "한국어", tts: "한국어" },
  { id: "en-US", flag: "🇺🇸", label: "English", tts: "English" },
  { id: "ja-JP", flag: "🇯🇵", label: "日本語", tts: "日本語" },
];

/** 시니어 서비스라 실제로 쓰이는 구간만 큰 버튼으로 노출한다. (앞뒤는 이하·이상으로 묶음) */
const ageChoices = [40, 50, 60, 70, 80, 90];
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
    ageOver: "이상",
    ageUnder: "이하",
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
    emptyAnswerTitle: "질문을 보내면 답변을 큰 글자로 보여드려요.",
    emptyAnswerHelp: "답변이 길면 오른쪽 카드로 이어지고, 왼쪽으로 넘기면 이전 답변을 다시 볼 수 있어요.",
    previousCards: "← 이전 답변",
    nextCards: "이어지는 답변 →",
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
    ageOver: "and above",
    ageUnder: "and under",
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
    emptyAnswerTitle: "Send a question and I’ll show the answer in large text.",
    emptyAnswerHelp: "Long answers continue on the next card. Swipe left to revisit previous answers.",
    previousCards: "← Previous answers",
    nextCards: "More answers →",
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
    ageOver: "以上",
    ageUnder: "以下",
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
    emptyAnswerTitle: "質問を送ると、回答を大きな文字で表示します。",
    emptyAnswerHelp: "回答が長い場合は次のカードに続きます。左へ戻ると前の回答を見られます。",
    previousCards: "← 前の回答",
    nextCards: "続きの回答 →",
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
  },
} satisfies Record<Language, Record<string, string>>;

type AboutFeature = { title: string; text: string };
type AboutStep = { step: string; title: string; text: string };
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
  footer: string;
};

const aboutCopy: Record<Language, AboutCopy> = {
  "ko-KR": {
    backToService: "서비스로 돌아가기",
    githubCta: "깃허브 저장소 바로가기",
    teamTitle: "만든 사람들",
    navFeatures: "핵심 기능",
    navWorkflow: "이용 흐름",
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
    footer: "© SilverLens. 사투리를 이해하는 AI로 시니어의 건강 식생활 접근성을 높입니다.",
  },
  "en-US": {
    backToService: "Back to service",
    githubCta: "Open GitHub repository",
    teamTitle: "Team",
    navFeatures: "Core features",
    navWorkflow: "Workflow",
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
    footer:
      "© SilverLens. AI that understands dialects, improving access to healthy eating for older adults.",
  },
  "ja-JP": {
    backToService: "サービスに戻る",
    githubCta: "GitHub リポジトリを開く",
    teamTitle: "制作メンバー",
    navFeatures: "主要機能",
    navWorkflow: "利用の流れ",
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

/**
 * rate가 통하지 않는 브라우저에서 쓰는 보조 수단.
 * 문장을 짧게 끊고 사이에 쉬는 시간을 넣어 실제 듣는 속도를 늦춘다.
 */
function narrationGapMs(rate: number) {
  const baseline = narrationRateOptions[DEFAULT_RATE_INDEX].value;
  if (rate >= baseline) return 0;
  return Math.round((baseline - rate) * 3200);
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
        <span className="info-tip" title={help}>i</span>
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
  const [screen, setScreen] = useState<PageScreen>("setup");
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
      for (
        let pageIndex = Math.max(startPage, 0);
        pageIndex < pageRequests.length;
        pageIndex += 1
      ) {
        if (sequence !== narrationSequenceRef.current) return;
        if (firstCardIndex !== null) setAnswerCardIndex(firstCardIndex + pageIndex);

        for (const chunkRequest of pageRequests[pageIndex]) {
          if (sequence !== narrationSequenceRef.current) return;
          // 실제로 읽을 순서가 됐을 때 처음 요청한다(듣지 않는 뒷장은 호출하지 않음).
          const blob = await chunkRequest();
          if (sequence !== narrationSequenceRef.current) return;

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
      const pageRequests: NarrationPageRequests = pages.map((page) =>
        splitNarrationText(plainTextFromMarkdown(page), 210).map((chunk) =>
          lazyNarrationChunk(() => fetchGuideNarrationChunk(chunk, lang)),
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
        const needsServer =
          shouldPreferServerTts(lang) || !browserRateIsReliable(voice, lang);

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

      const pageRequests: NarrationPageRequests = pages.map((page) =>
        splitNarrationText(plainTextFromMarkdown(page), 210).map((chunk) =>
          lazyNarrationChunk(() =>
            fetchNarrationChunk(chunk, lang, narrationControllersRef.current),
          ),
        ),
      );
      if (pageRequests.flat().length === 0) return [];

      setNarrationStatus((current) => ({ ...current, [turnId]: "preparing" }));
      narrationChunksRef.current.set(cacheKey, pageRequests);

      // 첫 장만 미리 만든다. 둘째 장부터는 어르신이 실제로 넘겨 들을 때 만든다.
      const firstPageRequests = pageRequests[0] ?? [];
      void Promise.all(firstPageRequests.map((request) => request())).then(
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

  // 음성 상세 메모는 새로고침 뒤에도 AI가 계속 참고해야 하므로 브라우저에 남긴다.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const stored = window.localStorage.getItem(HEALTH_NOTES_STORAGE_KEY);
        if (!stored) return;
        const parsed = JSON.parse(stored) as unknown;
        if (!Array.isArray(parsed)) return;
        const restored = parsed
          .filter((item): item is HealthNote =>
            Boolean(
              item &&
                typeof item === "object" &&
                typeof (item as HealthNote).text === "string" &&
                (item as HealthNote).text.trim().length > 0,
            ),
          )
          .slice(-MAX_HEALTH_NOTES);
        if (restored.length > 0) setHealthNotes(restored);
      } catch {
        // 저장된 메모가 깨져 있으면 무시하고 빈 상태로 시작한다.
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const persistHealthNotes = useCallback((notes: HealthNote[]) => {
    try {
      window.localStorage.setItem(
        HEALTH_NOTES_STORAGE_KEY,
        JSON.stringify(notes),
      );
    } catch {
      // 저장 공간이 막혀 있어도 화면 동작은 계속되어야 한다.
    }
  }, []);

  const addHealthNote = useCallback(
    (kind: HealthNote["kind"], text: string) => {
      const cleaned = text.trim();
      if (!cleaned) return;
      setHealthNotes((current) => {
        // 같은 문장을 두 번 저장하면 프롬프트만 길어지므로 건너뛴다.
        if (current.some((note) => note.text === cleaned && note.kind === kind)) {
          return current;
        }
        const next = [
          ...current,
          {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            kind,
            text: cleaned,
            savedAt: Date.now(),
          },
        ].slice(-MAX_HEALTH_NOTES);
        persistHealthNotes(next);
        return next;
      });
    },
    [persistHealthNotes],
  );

  const removeHealthNote = useCallback(
    (id: string) => {
      setHealthNotes((current) => {
        const next = current.filter((note) => note.id !== id);
        persistHealthNotes(next);
        return next;
      });
    },
    [persistHealthNotes],
  );

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
        (browserRateIsReliable(voice, current.lang) &&
          !shouldPreferServerTts(current.lang))
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
      const dialectUrl = process.env.NEXT_PUBLIC_DIALECT_API_URL;
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
            } else {
              setAllergyIds((current) =>
                uniqueItems([...current, ...analysis.allergies]),
              );
              setConditionIds((current) =>
                uniqueItems([...current, ...analysis.conditions]),
              );
              setShowAllergyInput(false);
              setShowConditionInput(false);
              // 목록으로 고를 수 없는 상세 설명("견과류 중에 특히 호두")을 원문 그대로 남긴다.
              addHealthNote(
                context === "allergy"
                  ? "allergy"
                  : context === "condition"
                    ? "condition"
                    : "setup",
                text,
              );
              const total =
                analysis.allergies.length + analysis.conditions.length;
              setProfileVoiceNotice(
                `${
                  total > 0
                    ? activeCopy.profileVoiceFound
                        .replace("{allergies}", String(analysis.allergies.length))
                        .replace("{conditions}", String(analysis.conditions.length))
                    : activeCopy.profileVoiceEmpty
                } ${activeCopy.noteSaved}`,
              );
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
      setChatError(activeCopy.imageOnly);
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setChatError(activeCopy.imageTooLarge);
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
      const attachmentLabels = [
        ...(pendingAudio ? [`🎙 ${activeCopy.audioLabel} ${formatDuration(pendingAudio.duration)}`] : []),
        ...(pendingImage ? [`🖼 ${activeCopy.photoOneLabel}`] : []),
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
          profile: {
            language: activeLanguage,
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
                    <span aria-hidden="true">{item.flag}</span>
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
            </div>
          </section>

          <section className="about-panel" id="about-workflow">
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

              <footer className="about-sitefoot">
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
              </footer>
            </div>
          </section>
        </main>
      </div>
    );
  }

  if (screen === "chat") {
    const isRecording = recordingContext === "chat";
    // 음성 인식 결과가 들어오면 글 입력창을 자동으로 펼쳐 확인·수정할 수 있게 한다.
    const isTextInputVisible = showTextInput || chatInput.trim().length > 0;
    return (
      <main className="app-shell">
        <Sidebar active="chat" onNavigate={setScreen} copy={activeCopy} />
        <section className="chat-screen">
          <header className="chat-header">
            <button className="back-button" onClick={() => setScreen("setup")}>
              {activeCopy.backToSetup}
            </button>
            <div className="profile-pills">
              <span>🌐 {languages.find((item) => item.id === activeLanguage)?.label}</span>
              <span>● {ageBand}{activeCopy.profileAge}</span>
            </div>
          </header>

          <h1>{activeCopy.headline}</h1>

          <section className="answer-section" aria-live="polite">
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
                  </>
                ) : (
                  <div className="answer-placeholder">
                    <strong>{activeCopy.emptyAnswerTitle}</strong>
                    <p>
                      {activeCopy.emptyAnswerHelp}
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
                aria-label={activeCopy.nextAnswer}
              >
                ›
              </button>
            </div>

            <div className="answer-history-footer">
              <span>{activeCopy.previousCards}</span>
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
              <span>{activeCopy.nextCards}</span>
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
              <button className="composer-tool" onClick={() => photoInputRef.current?.click()}>
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
                      <span className="attachment-icon">🖼️</span>
                      <span>
                        <strong>{activeCopy.photoAttached}</strong>
                        <small>{pendingImage.file.name}</small>
                      </span>
                      <button onClick={clearPendingImage} aria-label={activeCopy.photoAttached}>×</button>
                    </div>
                  )}
                </div>
                {transcript && <p>{activeCopy.transcript}: {transcript}</p>}
                <p>{activeCopy.sendPendingHelp}</p>
              </div>
            )}

            <button
              className="send-question"
              onClick={askGemini}
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
        </section>
      </main>
    );
  }

  const setupRecording = recordingContext === "setup";
  const canStart = nextStep === "complete" && !isTranscribingVoice;

  return (
    <main className="app-shell">
      <Sidebar active="setup" onNavigate={setScreen} copy={activeCopy} />
      <section className="setup-screen">
        <div className="setup-progress" aria-label={promptCopy[activeLanguage][nextStep]}>
          <span className={language ? "done" : "current"}>{activeCopy.progressLanguage} {language ? "✓" : ""}</span>
          <span className={gender ? "done" : nextStep === "gender" ? "current" : ""}>{activeCopy.progressGender} {gender ? "✓" : ""}</span>
          <span className={ageConfirmed ? "done" : nextStep === "age" ? "current" : ""}>
            {ageConfirmed
              ? `${activeCopy.progressAge} ✓`
              : `${activeCopy.next}: ${
                  nextStep === "language"
                    ? activeCopy.progressLanguage
                    : nextStep === "gender"
                      ? activeCopy.progressGender
                      : activeCopy.progressAge
                }`}
          </span>
        </div>

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

        <fieldset className="form-section">
          <legend>{activeCopy.languageLegend}</legend>
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

        <fieldset className="form-section age-section">
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
                      ? activeCopy.ageUnder
                      : isLast
                        ? activeCopy.ageOver
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

        <button
          className={canStart ? "start-button" : "start-button disabled"}
          onClick={beginChat}
          aria-disabled={!canStart}
        >
          <span>{activeCopy.start}</span>
          <span aria-hidden="true">›</span>
        </button>
        {!canStart && (
          <p className="completion-hint">{activeCopy.completionHint}</p>
        )}
      </section>
    </main>
  );
}
