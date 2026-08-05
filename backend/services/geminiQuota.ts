/**
 * Gemini 무료 한도(429 RESOURCE_EXHAUSTED)를 다루는 공통 도구.
 *
 * 무료 티어는 모델마다 분당·하루 요청 수가 정해져 있어서 시연 중에도 쉽게 막힙니다.
 * 여기서는 429를 일반 오류와 구분해 두고, 응답에 담긴 재시도 대기 시간을 읽어
 * 화면에 "몇 초 뒤에 다시 시도"까지 안내할 수 있게 합니다.
 */

export class GeminiQuotaError extends Error {
  readonly retryAfterSeconds: number;
  readonly triedModels: string[];

  constructor(
    message: string,
    retryAfterSeconds: number,
    triedModels: string[],
  ) {
    super(message);
    this.name = "GeminiQuotaError";
    this.retryAfterSeconds = retryAfterSeconds;
    this.triedModels = triedModels;
  }
}

export function isGeminiQuotaError(error: unknown): error is GeminiQuotaError {
  return error instanceof GeminiQuotaError;
}

/**
 * Gemini는 오류 본문에 RetryInfo(예: "retryDelay": "48.3s")를 함께 돌려준다.
 * 문자열 형태가 바뀌어도 무너지지 않게 정규식으로 느슨하게 읽는다.
 */
export function parseRetryAfterSeconds(rawBody: string, fallback = 60) {
  const retryDelay = /"?retryDelay"?\s*[:=]\s*"?(\d+(?:\.\d+)?)s/i.exec(rawBody);
  if (retryDelay) return Math.ceil(Number(retryDelay[1]));

  const retryIn = /retry in\s+(\d+(?:\.\d+)?)\s*s/i.exec(rawBody);
  if (retryIn) return Math.ceil(Number(retryIn[1]));

  return fallback;
}

export function quotaMessage(language?: string) {
  if (language === "en-US") {
    return "The free AI usage limit for today has been reached. Please try again in a moment.";
  }
  if (language === "ja-JP") {
    return "無料のAI利用上限に達しました。少し待ってからもう一度お試しください。";
  }
  return "AI 무료 사용 한도에 도달했습니다. 잠시 뒤에 다시 시도해 주세요.";
}
