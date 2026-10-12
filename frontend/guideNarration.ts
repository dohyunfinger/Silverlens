/**
 * 미리 만들어 둔 음성으로 읽는 안내 문구.
 *
 * 안내 문구는 매번 같은 문장이라 실시간 TTS로 만들면 크레딧과 대기 시간만 든다.
 * `npm run narration:guide`가 이 문구들로 public/narration/ 아래 음성 파일을 만들고,
 * 앱은 같은 문구를 재생할 때 그 파일을 먼저 쓴다.
 *
 * 생성 스크립트(Node)도 이 파일을 직접 읽으므로 JSX나 다른 모듈을 import하지 않는다.
 * 문구를 고치면 스크립트를 다시 돌려야 새 문구가 미리 만든 음성으로 나온다.
 * (고친 문구는 음성 파일이 생길 때까지 기존 경로로 읽힌다.)
 */

export type GuideNarrationLanguage = "ko-KR" | "en-US" | "ja-JP";

export const guideNarrationCopy = {
  "ko-KR": {
    welcomeVoice:
      "마이크를 눌러 말씀하시고, 보내기를 누르세요. 사진이나 글로도 질문할 수 있어요.",
    profileIntroVoice: "편하신 언어부터 골라 주세요. 나중에 입력하시려면 모두 건너뛰기를 누르세요.",
    answerSpeedSample: "이 속도는 어떠세요? 아래에서 조절해 주세요.",
    setupLanguage: "사용할 언어를 선택해 주세요.",
    setupGender: "성별을 선택해 주세요.",
    setupAge: "해당하는 나이대 버튼을 눌러 주세요.",
    setupComplete: "기본 설정이 끝났습니다. 알레르기와 질병·건강 상태는 선택해서 추가할 수 있어요.",
    audioAttached: "음성이 첨부되었습니다. 사진이나 글을 더한 뒤 질문 보내기 버튼을 눌러 주세요.",
    photoAttached: "사진이 첨부되었습니다. 음성이나 글을 더한 뒤 질문 보내기 버튼을 눌러 주세요.",
    photoPurposeLabelTip: "글자가 화면을 가득 채우게, 봉지를 펴서 찍어 주세요.",
    photoPurposeFoodTip: "음식 전체가 들어오게, 위에서 내려다보며 찍어 주세요.",
    photoPurposeMedicineTip: "약 이름과 하루 몇 번 먹는지가 보이게 찍어 주세요.",
  },
  "en-US": {
    welcomeVoice:
      "Tap the microphone, speak, then tap Send. You can also use a photo or text.",
    profileIntroVoice: "Choose your preferred language. To add your information later, tap Skip all.",
    answerSpeedSample: "I will read answers at this speed.",
    setupLanguage: "Please choose your language.",
    setupGender: "Please choose your gender.",
    setupAge: "Please tap the button for your age group.",
    setupComplete: "Basic setup is complete. You may add allergy and health information.",
    audioAttached: "Your recording is attached. Add a photo or text if needed, then press Send question.",
    photoAttached: "Your photo is attached. Add a recording or text if needed, then press Send question.",
    photoPurposeLabelTip: "Flatten the package and fill the screen with the text.",
    photoPurposeFoodTip: "Look down from above so the whole dish fits in.",
    photoPurposeMedicineTip: "Make sure the medicine name and daily doses are visible.",
  },
  "ja-JP": {
    welcomeVoice:
      "マイクを押して話し、送信を押してください。写真や文字でも質問できます。",
    profileIntroVoice: "使いやすい言語を選んでください。情報をあとで入力する場合は、すべてスキップを押してください。",
    answerSpeedSample: "この速さで回答をお読みします。",
    setupLanguage: "使用する言語を選んでください。",
    setupGender: "性別を選んでください。",
    setupAge: "該当する年齢層のボタンを押してください。",
    setupComplete: "基本設定が完了しました。アレルギーや病気・健康状態も追加できます。",
    audioAttached: "音声を追加しました。必要なら写真や文字も足して、「質問を送る」を押してください。",
    photoAttached: "写真を追加しました。必要なら音声や文字も足して、「質問を送る」を押してください。",
    photoPurposeLabelTip: "袋を平らに伸ばし、文字が画面いっぱいになるように撮ってください。",
    photoPurposeFoodTip: "真上から見下ろして、料理全体が入るように撮ってください。",
    photoPurposeMedicineTip: "薬の名前と一日何回飲むかが見えるように撮ってください。",
  },
} satisfies Record<GuideNarrationLanguage, Record<string, string>>;

export const GUIDE_NARRATION_MANIFEST_URL = "/narration/manifest.json";

/** 공백 차이로 같은 문구를 다른 문구로 보지 않도록 정규화한 키. */
export function guideNarrationKey(language: string, text: string) {
  return `${language}|${text.replace(/\s+/g, " ").trim()}`;
}

export type GuideNarrationManifest = {
  voices: Record<string, string>;
  /** guideNarrationKey → public/ 기준 음성 파일 경로 */
  entries: Record<string, string>;
};
