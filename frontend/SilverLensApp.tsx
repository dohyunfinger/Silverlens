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

const ageBands = Array.from({ length: 12 }, (_, index) => (index + 1) * 10);
const narrationRateOptions = [
  { label: { "ko-KR": "아주 천천히", "en-US": "Very slow", "ja-JP": "とてもゆっくり" }, value: 0.72 },
  { label: { "ko-KR": "조금 느리게", "en-US": "A little slow", "ja-JP": "少しゆっくり" }, value: 0.82 },
  { label: { "ko-KR": "보통", "en-US": "Normal", "ja-JP": "ふつう" }, value: 0.95 },
  { label: { "ko-KR": "조금 빠르게", "en-US": "A little fast", "ja-JP": "少し速く" }, value: 1.08 },
  { label: { "ko-KR": "빠르게", "en-US": "Fast", "ja-JP": "速く" }, value: 1.2 },
] as const;

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
    age: "上下に動かして年齢層を選んでください。",
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
    languageLegend: "언어",
    genderLegend: "성별",
    male: "남자",
    female: "여자",
    ageLegend: "나이",
    years: "대",
    ageHelp: "손가락이나 마우스로 움직이거나 눌러 선택하세요.",
    allergyTitle: "알레르기 정보",
    allergyHelp: "먹으면 불편한 음식",
    conditionTitle: "질병 정보",
    conditionHelp: "현재 치료 중인 질환",
    noneOption: "해당없음",
    directInput: "+ 직접 입력",
    voiceInput: "🎙 말해서 입력",
    recordingDone: "■ 녹음 완료",
    inputPlaceholder: "입력 후 엔터",
    healthLanguageNote: "등록한 건강 정보는 선택한 언어에 맞춰 표시됩니다.",
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
    aboutEyebrow: "SENIOR FOOD & CARE COMPANION",
    aboutTagline: "말 한마디가 안전한 식탁으로 이어지도록",
    aboutLead: "실버렌즈는 음성, 사진, 생활 표현을 이해하고 알레르기와 질병 정보를 함께 살펴 쉬운 식생활 답변을 전합니다.",
    aboutQuote: "익숙한 말투 그대로 질문해도, 앞의 이야기를 잊지 않는 식생활 도우미",
    aboutNote1: "사투리 표현은 표준어와 연결하고, 등록한 건강정보는 선택한 언어로 보여줍니다.",
    aboutNote2: "위험하거나 권장하기 어려운 음식은 답변 속에 숨기지 않고 카드 상단에 먼저 경고합니다.",
    aboutPillar1: "말로 묻는 편안함",
    aboutPillar1Text: "녹음된 질문과 방언 참고 데이터를 함께 읽어 이해합니다.",
    aboutPillar2: "이어지는 대화",
    aboutPillar2Text: "직전 질문과 답변을 함께 전달해 후속 질문을 이어갑니다.",
    aboutPillar3: "먼저 보이는 주의",
    aboutPillar3Text: "등록 알레르기와 직접 충돌하면 빨간 경고를 표시하고 해당 재료를 권하지 않습니다.",
    aboutHow: "질문에서 답변까지",
    aboutStep1: "말하고 찍기",
    aboutStep1Small: "글 · 음성 · 사진",
    aboutStep2: "맥락과 데이터 확인",
    aboutStep2Small: "대화 · 방언 · 건강정보",
    aboutStep3: "쉬운 답변과 음성",
    aboutStep3Small: "경고 · 카드 · TTS",
    aboutFooter: "어르신의 말과 일상 사이, 더 안전한 이해를 만듭니다.",
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
    languageLegend: "Language",
    genderLegend: "Gender",
    male: "Male",
    female: "Female",
    ageLegend: "Age",
    years: "s",
    ageHelp: "Move or tap with your finger or mouse to choose.",
    allergyTitle: "Allergies",
    allergyHelp: "Foods that make you uncomfortable",
    conditionTitle: "Health conditions",
    conditionHelp: "Conditions currently being treated",
    noneOption: "None",
    directInput: "+ Type directly",
    voiceInput: "🎙 Speak to enter",
    recordingDone: "■ Finish recording",
    inputPlaceholder: "Type and press Enter",
    healthLanguageNote: "Registered health information is shown in the selected language.",
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
    aboutEyebrow: "SENIOR FOOD & CARE COMPANION",
    aboutTagline: "Turning everyday words into safer meals",
    aboutLead: "SilverLens understands voice, photos, and everyday phrasing, then considers allergies and conditions to provide simple food guidance.",
    aboutQuote: "A food companion that remembers the conversation, even when questions are asked naturally.",
    aboutNote1: "Dialect expressions are connected to standard terms, and registered health info appears in the selected language.",
    aboutNote2: "Risky or unsuitable foods are not hidden in the answer; warnings appear first on the card.",
    aboutPillar1: "Ask comfortably by voice",
    aboutPillar1Text: "Voice questions and dialect reference data are read together for context.",
    aboutPillar2: "Conversations continue",
    aboutPillar2Text: "Recent questions and answers are passed along so follow-ups make sense.",
    aboutPillar3: "Cautions come first",
    aboutPillar3Text: "Direct allergy conflicts show a red warning and avoid recommending that ingredient.",
    aboutHow: "From question to answer",
    aboutStep1: "Speak and snap",
    aboutStep1Small: "Text · voice · photo",
    aboutStep2: "Check context and data",
    aboutStep2Small: "Chat · dialect · health info",
    aboutStep3: "Easy answer and voice",
    aboutStep3Small: "Warnings · cards · TTS",
    aboutFooter: "Building safer understanding between daily words and meals.",
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
    languageLegend: "言語",
    genderLegend: "性別",
    male: "男性",
    female: "女性",
    ageLegend: "年齢",
    years: "代",
    ageHelp: "指やマウスで動かす、または押して選びます。",
    allergyTitle: "アレルギー情報",
    allergyHelp: "食べると不調になる食品",
    conditionTitle: "病気の情報",
    conditionHelp: "現在治療中の病気",
    noneOption: "該当なし",
    directInput: "+ 直接入力",
    voiceInput: "🎙 話して入力",
    recordingDone: "■ 録音完了",
    inputPlaceholder: "入力後 Enter",
    healthLanguageNote: "登録した健康情報は選択した言語で表示されます。",
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
    aboutEyebrow: "SENIOR FOOD & CARE COMPANION",
    aboutTagline: "日常の言葉を、より安全な食卓へ",
    aboutLead: "シルバーレンズは音声、写真、生活の表現を理解し、アレルギーや病気の情報を合わせてやさしい食生活の回答を届けます。",
    aboutQuote: "自然な言い方の質問でも、前の話を忘れない食生活サポーター。",
    aboutNote1: "方言表現を標準語につなげ、登録した健康情報は選択した言語で表示します。",
    aboutNote2: "危険またはおすすめしにくい食品は回答内に隠さず、カード上部で先に警告します。",
    aboutPillar1: "声で聞ける安心感",
    aboutPillar1Text: "録音された質問と方言参考データを一緒に読み取り、意味を理解します。",
    aboutPillar2: "続く会話",
    aboutPillar2Text: "直前の質問と回答を一緒に渡し、続きの質問にも対応します。",
    aboutPillar3: "先に見える注意",
    aboutPillar3Text: "登録アレルギーと直接ぶつかる場合は赤い警告を表示し、その材料をすすめません。",
    aboutHow: "質問から回答まで",
    aboutStep1: "話して撮る",
    aboutStep1Small: "文字 · 音声 · 写真",
    aboutStep2: "文脈とデータ確認",
    aboutStep2Small: "会話 · 方言 · 健康情報",
    aboutStep3: "やさしい回答と音声",
    aboutStep3Small: "警告 · カード · TTS",
    aboutFooter: "高齢者の言葉と日常の間に、より安全な理解をつくります。",
  },
} satisfies Record<Language, Record<string, string>>;

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

export default function SilverLensApp() {
  const [screen, setScreen] = useState<PageScreen>("setup");
  const [language, setLanguage] = useState<Language | null>(null);
  const [gender, setGender] = useState<Gender | null>(null);
  const [ageBand, setAgeBand] = useState(70);
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [allergyIds, setAllergyIds] = useState<string[]>([]);
  const [conditionIds, setConditionIds] = useState<string[]>([]);
  const [autoVoiceGuide, setAutoVoiceGuide] = useState(true);
  const [narrationRateIndex, setNarrationRateIndex] = useState(1);
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
        utterance.rate = narrationRate;
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
    [activeLanguage, narrationRate, stopNarration],
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
          utterance.rate = narrationRate;
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
    [activeLanguage, narrationRate, stopNarration],
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
            audio.playbackRate = narrationRate;
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
      narrationRate,
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
      const storedRate = Number(window.localStorage.getItem("silverlens:narration-rate-index"));
      setAutoVoiceGuide(enabled);
      if (Number.isInteger(storedRate) && storedRate >= 0 && storedRate < narrationRateOptions.length) {
        setNarrationRateIndex(storedRate);
      }
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

  const changeNarrationRate = (event: ChangeEvent<HTMLInputElement>) => {
    const next = Number(event.currentTarget.value);
    setNarrationRateIndex(next);
    window.localStorage.setItem("silverlens:narration-rate-index", String(next));
    if (narrationAudioRef.current) {
      narrationAudioRef.current.playbackRate = narrationRateOptions[next].value;
    }
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
              const total =
                analysis.allergies.length + analysis.conditions.length;
              setProfileVoiceNotice(
                total > 0
                  ? activeCopy.profileVoiceFound
                      .replace("{allergies}", String(analysis.allergies.length))
                      .replace("{conditions}", String(analysis.conditions.length))
                  : activeCopy.profileVoiceEmpty,
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
    return (
      <main className="app-shell about-shell">
        <Sidebar active="about" onNavigate={setScreen} copy={activeCopy} />
        <section className="about-page">
          <header className="about-topbar">
            <button className="about-back" onClick={() => setScreen("setup")}>
              {activeCopy.backToSetup}
            </button>
            <span className="about-seal" aria-hidden="true">SL</span>
          </header>

          <section className="about-label-hero">
            <div className="about-rule" />
            <p className="about-eyebrow">{activeCopy.aboutEyebrow}</p>
            <h1 className="about-wordmark">SILVERLENS</h1>
            <p className="about-hero-tagline">
              {activeCopy.aboutTagline}
            </p>
            <div className="about-rule" />
            <p className="about-hero-lead">
              {activeCopy.aboutLead}
            </p>
          </section>

          <section className="about-manifesto">
            <p className="about-index">NOTE 01 — WHY SILVERLENS</p>
            <blockquote>
              {activeCopy.aboutQuote}
            </blockquote>
            <div className="about-manifesto-notes">
              <p>
                {activeCopy.aboutNote1}
              </p>
              <p>
                {activeCopy.aboutNote2}
              </p>
            </div>
          </section>

          <section className="about-pillars">
            <p className="about-index about-index-onlight">NOTE 02 — TASTING NOTES</p>
            <div className="about-pillar-grid">
              <article>
                <span>01</span>
                <h2>{activeCopy.aboutPillar1}</h2>
                <p>{activeCopy.aboutPillar1Text}</p>
              </article>
              <article>
                <span>02</span>
                <h2>{activeCopy.aboutPillar2}</h2>
                <p>{activeCopy.aboutPillar2Text}</p>
              </article>
              <article>
                <span>03</span>
                <h2>{activeCopy.aboutPillar3}</h2>
                <p>{activeCopy.aboutPillar3Text}</p>
              </article>
            </div>
          </section>

          <section className="about-flow">
            <div>
              <p className="about-index">NOTE 03 — HOW IT WORKS</p>
              <h2>{activeCopy.aboutHow}</h2>
            </div>
            <ol>
              <li><span>1</span><strong>{activeCopy.aboutStep1}</strong><small>{activeCopy.aboutStep1Small}</small></li>
              <li><span>2</span><strong>{activeCopy.aboutStep2}</strong><small>{activeCopy.aboutStep2Small}</small></li>
              <li><span>3</span><strong>{activeCopy.aboutStep3}</strong><small>{activeCopy.aboutStep3Small}</small></li>
            </ol>
          </section>

          <footer className="about-footer">
            <span className="about-seal about-seal-lg" aria-hidden="true">SL</span>
            <strong>SilverLens</strong>
            <p>{activeCopy.aboutFooter}</p>
          </footer>
        </section>
      </main>
    );
  }

  if (screen === "chat") {
    const isRecording = recordingContext === "chat";
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
                        <span aria-hidden="true">!</span>
                        <div>
                          <strong>
                            {activeLanguage === "en-US"
                              ? activeAnswerCard.riskLevel === "danger"
                                ? activeCopy.foodWarning
                                : activeCopy.foodCheck
                              : activeLanguage === "ja-JP"
                                ? activeAnswerCard.riskLevel === "danger"
                                  ? activeCopy.foodWarning
                                  : activeCopy.foodCheck
                                : activeAnswerCard.riskLevel === "danger"
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
            <label htmlFor="chat-question">{activeCopy.textQuestion}</label>
            <textarea
              id="chat-question"
              value={chatInput}
              onChange={(event) => setChatInput(event.target.value)}
              placeholder={activeCopy.questionPlaceholder}
              maxLength={1000}
              rows={3}
            />

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

            <div className="composer-actions">
              <button
                className={isRecording ? "composer-tool recording" : "composer-tool"}
                onClick={() => toggleRecording("chat")}
              >
                <span>{isRecording ? "●" : "🎙️"}</span>
                <strong>{isRecording ? activeCopy.recording : activeCopy.voiceRecord}</strong>
                <small>{isRecording ? activeCopy.recordingHelp : activeCopy.voiceRecordHelp}</small>
              </button>
              <button className="composer-tool" onClick={() => photoInputRef.current?.click()}>
                <span>📷</span>
                <strong>{activeCopy.uploadPhoto}</strong>
                <small>{activeCopy.uploadPhotoHelp}</small>
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
                className="send-question"
                onClick={askGemini}
                disabled={
                  isLoadingAnswer ||
                  (!chatInput.trim() && !pendingAudio && !pendingImage)
                }
              >
                <span>➤</span>
                <strong>{isLoadingAnswer ? activeCopy.sendingQuestion : activeCopy.sendQuestion}</strong>
                <small>{activeCopy.sendHelp}</small>
              </button>
            </div>
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
  const ageIndex = ageBands.indexOf(ageBand);
  const previousAge = ageBands[Math.max(0, ageIndex - 1)];
  const nextAge = ageBands[Math.min(ageBands.length - 1, ageIndex + 1)];

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
          <small>{activeCopy.answerSpeedHelp}</small>
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
          <div
            className={ageConfirmed ? "age-picker confirmed" : "age-picker"}
            onWheel={(event) => {
              event.preventDefault();
              moveAge(event.deltaY > 0 ? 1 : -1);
            }}
          >
            <div className="age-controls">
              <button onClick={() => moveAge(-1)} disabled={ageIndex === 0} aria-label={activeCopy.prevAnswer}>⌃</button>
              <button className="age-wheel" onClick={toggleAgeConfirmation} aria-pressed={ageConfirmed}>
                <span>{previousAge}{activeCopy.years}</span>
                <strong>{ageBand}{activeCopy.years}</strong>
                <span>{nextAge}{activeCopy.years}</span>
              </button>
              <button onClick={() => moveAge(1)} disabled={ageIndex === ageBands.length - 1} aria-label={activeCopy.nextAnswer}>⌄</button>
            </div>
            <div className="age-help">
              <strong>10{activeCopy.years} ~ 120{activeCopy.years}</strong>
              <span>{activeCopy.ageHelp}</span>
              <em>{ageConfirmed ? "✓" : promptCopy[activeLanguage].age}</em>
            </div>
          </div>
        </fieldset>

        <div className="health-grid">
          <section className="health-card">
            <div className="health-title">
              <h2>{activeCopy.allergyTitle}</h2>
              <span className="info-tip" title={activeCopy.allergyHelp}>i</span>
            </div>
            <p>{activeCopy.allergyHelp}</p>
            <div className="health-actions">
              <button onClick={() => setShowAllergyInput((value) => !value)}>{activeCopy.directInput}</button>
              <button
                className={recordingContext === "allergy" ? "recording" : ""}
                onClick={() => toggleRecording("allergy")}
                disabled={isTranscribingVoice}
              >
                {recordingContext === "allergy" ? activeCopy.recordingDone : activeCopy.voiceInput}
              </button>
            </div>
            {showAllergyInput && (
              <input
                autoFocus
                placeholder={activeCopy.inputPlaceholder}
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
            <ul className="health-option-list allergy" role="listbox" aria-multiselectable="true" aria-label={activeCopy.allergyTitle}>
              <li>
                <button
                  type="button"
                  role="option"
                  aria-selected={allergyIds.length === 0}
                  className={`health-option none-option${allergyIds.length === 0 ? " selected" : ""}`}
                  onClick={() => setAllergyIds([])}
                >
                  <span>{activeCopy.noneOption}</span>
                  {allergyIds.length === 0 && <span className="check-mark" aria-hidden="true">✓</span>}
                </button>
              </li>
              {allergyOptions.map((item) => {
                const selected = allergyIds.includes(item.id);
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={selected}
                      className={`health-option${selected ? " selected" : ""}`}
                      onClick={() => toggleHealthId(item.id, setAllergyIds)}
                    >
                      <span>{item.label}</span>
                      {selected && <span className="check-mark" aria-hidden="true">✓</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
            <div className="tag-list">
              {allergyIds
                .filter((id) => id.startsWith("custom:"))
                .map((id) => (
                  <button key={id} onClick={() => setAllergyIds((items) => items.filter((value) => value !== id))}>
                    {getHealthLabel(id, activeLanguage)} ×
                  </button>
                ))}
            </div>
          </section>

          <section className="health-card">
            <div className="health-title">
              <h2>{activeCopy.conditionTitle}</h2>
              <span className="info-tip" title={activeCopy.conditionHelp}>i</span>
            </div>
            <p>{activeCopy.conditionHelp}</p>
            <div className="health-actions">
              <button onClick={() => setShowConditionInput((value) => !value)}>{activeCopy.directInput}</button>
              <button
                className={recordingContext === "condition" ? "recording" : ""}
                onClick={() => toggleRecording("condition")}
                disabled={isTranscribingVoice}
              >
                {recordingContext === "condition" ? activeCopy.recordingDone : activeCopy.voiceInput}
              </button>
            </div>
            {showConditionInput && (
              <input
                autoFocus
                placeholder={activeCopy.inputPlaceholder}
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
            <ul className="health-option-list condition" role="listbox" aria-multiselectable="true" aria-label={activeCopy.conditionTitle}>
              <li>
                <button
                  type="button"
                  role="option"
                  aria-selected={conditionIds.length === 0}
                  className={`health-option none-option${conditionIds.length === 0 ? " selected" : ""}`}
                  onClick={() => setConditionIds([])}
                >
                  <span>{activeCopy.noneOption}</span>
                  {conditionIds.length === 0 && <span className="check-mark" aria-hidden="true">✓</span>}
                </button>
              </li>
              {conditionOptions.map((item) => {
                const selected = conditionIds.includes(item.id);
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={selected}
                      className={`health-option${selected ? " selected" : ""}`}
                      onClick={() => toggleHealthId(item.id, setConditionIds)}
                    >
                      <span>{item.label}</span>
                      {selected && <span className="check-mark" aria-hidden="true">✓</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
            <div className="tag-list">
              {conditionIds
                .filter((id) => id.startsWith("custom:"))
                .map((id) => (
                  <button key={id} onClick={() => setConditionIds((items) => items.filter((value) => value !== id))}>
                    {getHealthLabel(id, activeLanguage)} ×
                  </button>
                ))}
            </div>
          </section>
        </div>
        <p className="health-language-note">
          {activeCopy.healthLanguageNote}
        </p>

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
