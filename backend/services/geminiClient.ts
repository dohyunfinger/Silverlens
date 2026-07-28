import {
  GeminiQuotaError,
  parseRetryAfterSeconds,
  quotaMessage,
} from "./geminiQuota";

const ENDPOINT_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const SERVER_ERROR_RETRY_DELAY_MS = 450;
/** 한도에 걸린 모델을 다시 찔러 보기까지 최대 대기 시간. */
const MAX_COOLDOWN_MS = 5 * 60 * 1000;

/**
 * 한도(429)나 사용 불가(404) 판정을 받은 모델을 잠시 건너뛴다.
 * 매 요청마다 막힌 모델을 먼저 부르면 응답이 그만큼 늦어진다.
 */
const modelCooldownUntil = new Map<string, number>();

export type GeminiCallResult = {
  /** 응답 본문 원문. 호출한 쪽에서 필요한 형태로 파싱한다. */
  rawBody: string;
  /** 실제로 답을 준 모델 이름. 폴백이 일어났는지 확인할 때 쓴다. */
  modelUsed: string;
};

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readErrorMessage(rawBody: string, fallback: string) {
  try {
    const parsed = JSON.parse(rawBody) as { error?: { message?: string } };
    return parsed.error?.message?.trim() || fallback;
  } catch {
    return fallback;
  }
}

function markCooldown(model: string, seconds: number) {
  const until = Date.now() + Math.min(seconds * 1000, MAX_COOLDOWN_MS);
  modelCooldownUntil.set(model, until);
}

function pickAvailableModels(models: string[]) {
  const now = Date.now();
  const ready = models.filter((model) => (modelCooldownUntil.get(model) ?? 0) <= now);
  // 전부 쉬는 중이면 그래도 원래 순서로 다시 시도한다(영구 차단 방지).
  return ready.length > 0 ? ready : models;
}

/** 모델을 바꿔도 결과가 같은 오류. 이때는 폴백하지 않고 바로 알린다. */
function isFatalStatus(status: number) {
  return status === 401 || status === 403;
}

export function getGeminiModelCooldowns() {
  const now = Date.now();
  return [...modelCooldownUntil.entries()]
    .filter(([, until]) => until > now)
    .map(([model, until]) => ({
      model,
      secondsLeft: Math.ceil((until - now) / 1000),
    }));
}

/**
 * generateContent 를 모델 목록 순서대로 시도한다.
 *
 * - 429(한도 초과)면 곧바로 다음 모델로 넘어가고, 그 모델은 잠시 쉬게 표시한다.
 *   기다리는 대신 여유 있는 모델을 쓰는 것이 시연 중에는 훨씬 낫다.
 * - 5xx(서버 일시 오류)는 같은 모델로 한 번만 다시 시도한 뒤 다음 모델로 넘어간다.
 * - 404·400(모델이 없거나 더 이상 제공되지 않음)도 다음 모델로 넘어간다.
 * - 401·403(키·권한 문제)은 모델을 바꿔도 같으므로 즉시 던진다.
 * - 모든 모델이 429면 GeminiQuotaError 를 던져 라우트에서 429로 안내할 수 있게 한다.
 */
export async function callGeminiGenerateContent({
  apiKey,
  models,
  body,
  language,
  defaultErrorMessage = "Gemini API 호출에 실패했습니다.",
}: {
  apiKey: string;
  models: string[];
  body: unknown;
  language?: string;
  defaultErrorMessage?: string;
}): Promise<GeminiCallResult> {
  const serializedBody = JSON.stringify(body);
  const candidates = pickAvailableModels(models);
  const triedModels: string[] = [];
  let quotaRetrySeconds = 0;
  let lastFailure: Error | null = null;

  for (const model of candidates) {
    triedModels.push(model);

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await fetch(
        `${ENDPOINT_BASE}/${encodeURIComponent(model)}:generateContent`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey,
          },
          body: serializedBody,
        },
      );
      const rawBody = await response.text();

      if (response.ok) {
        modelCooldownUntil.delete(model);
        return { rawBody, modelUsed: model };
      }

      const message = readErrorMessage(rawBody, defaultErrorMessage);
      lastFailure = new Error(message);

      if (isFatalStatus(response.status)) throw lastFailure;

      if (response.status === 429) {
        const headerDelay = Number(response.headers.get("retry-after") ?? "");
        const seconds =
          Number.isFinite(headerDelay) && headerDelay > 0
            ? Math.ceil(headerDelay)
            : parseRetryAfterSeconds(rawBody);
        quotaRetrySeconds = Math.max(quotaRetrySeconds, seconds);
        markCooldown(model, seconds);
        console.warn(
          `[SilverLens] ${model} 한도 초과(429). 다음 모델로 넘어갑니다. 재시도 권장 ${seconds}초`,
        );
        break;
      }

      if (response.status >= 500 && attempt === 0) {
        await wait(SERVER_ERROR_RETRY_DELAY_MS);
        continue;
      }

      // 404·400·503 등은 다른 모델에서 성공할 수 있으므로 잠시 쉬게 두고 넘어간다.
      markCooldown(model, 120);
      console.warn(
        `[SilverLens] ${model} 사용 불가(${response.status}). 다음 모델로 넘어갑니다. ${message.slice(0, 90)}`,
      );
      break;
    }
  }

  if (quotaRetrySeconds > 0) {
    throw new GeminiQuotaError(
      quotaMessage(language),
      quotaRetrySeconds,
      triedModels,
    );
  }

  throw lastFailure ?? new Error(defaultErrorMessage);
}
