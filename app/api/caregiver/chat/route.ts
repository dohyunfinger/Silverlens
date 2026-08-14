import { NextRequest, NextResponse } from "next/server";
import {
  prepareCaregiverChat,
  saveCaregiverChat,
} from "../../../../backend/services/careData";
import {
  caregiverFromRequest,
  isSameOriginMutation,
} from "../../../../backend/services/caregiverRequest";
import {
  generateSeniorFriendlyAnswer,
  IMAGE_PURPOSES,
  isMeaningfulText,
  type ImagePurpose,
  type InlineImage,
  type InlineMedia,
} from "../../../../backend/services/geminiService";
import { isGeminiQuotaError } from "../../../../backend/services/geminiQuota";

export const dynamic = "force-dynamic";

const MAX_IMAGES = 4;
const MAX_INLINE_DATA_LENGTH = 18 * 1024 * 1024;

function isInlineMedia(value: unknown): value is InlineMedia {
  if (!value || typeof value !== "object") return false;
  const media = value as Partial<InlineMedia>;
  return Boolean(
    typeof media.data === "string" &&
    media.data.length > 0 &&
    typeof media.mimeType === "string" &&
    media.mimeType.length > 0,
  );
}

function cleanImages(value: unknown): InlineImage[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isInlineMedia)
    .filter((image) => image.mimeType.toLowerCase().startsWith("image/"))
    .slice(0, MAX_IMAGES)
    .map((image) => {
      const purpose = IMAGE_PURPOSES.includes(
        (image as InlineMedia & { purpose?: unknown }).purpose as ImagePurpose,
      )
        ? ((image as InlineMedia & { purpose?: unknown }).purpose as ImagePurpose)
        : null;
      return {
        media: { data: image.data, mimeType: image.mimeType },
        purpose,
      };
    });
}

export async function POST(request: NextRequest) {
  if (!isSameOriginMutation(request)) {
    return NextResponse.json({ error: "허용되지 않은 요청입니다." }, { status: 403 });
  }
  const caregiver = await caregiverFromRequest(request);
  if (!caregiver) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  try {
    const body = (await request.json()) as {
      message?: unknown;
      threadId?: unknown;
      seniorId?: unknown;
      audio?: unknown;
      images?: unknown;
    };
    const message = typeof body.message === "string" ? body.message.trim().slice(0, 1600) : "";
    const audio =
      isInlineMedia(body.audio) && body.audio.mimeType.toLowerCase().startsWith("audio/")
        ? body.audio
        : null;
    const images = cleanImages(body.images);
    if (!isMeaningfulText(message) && !audio && images.length === 0) {
      return NextResponse.json({ error: "글, 음성, 사진 중 하나 이상을 보내 주세요." }, { status: 400 });
    }
    const attachedBytes =
      (audio?.data.length ?? 0) +
      images.reduce((total, image) => total + image.media.data.length, 0);
    if (attachedBytes > MAX_INLINE_DATA_LENGTH) {
      return NextResponse.json(
        { error: "첨부 파일이 너무 큽니다. 사진 수를 줄이거나 더 짧은 음성을 사용해 주세요." },
        { status: 413 },
      );
    }
    const storedMessage =
      message ||
      [images.length ? `사진 ${images.length}장` : "", audio ? "음성" : ""]
        .filter(Boolean)
        .join(" · ") + " 질문";
    const prepared = await prepareCaregiverChat({
      caregiverUid: caregiver.uid,
      threadId: typeof body.threadId === "string" ? body.threadId : undefined,
      seniorId: typeof body.seniorId === "string" ? body.seniorId : null,
      message: storedMessage,
    });
    const result = await generateSeniorFriendlyAnswer(
      message,
      prepared.profile,
      { audio, images },
      prepared.history,
      prepared.caregiverContext,
    );
    await saveCaregiverChat({
      caregiverUid: caregiver.uid,
      threadId: prepared.threadId,
      message: storedMessage,
      answer: result.answer,
      riskLevel: result.riskLevel,
      warningMessage: result.warningMessage,
    });
    return NextResponse.json(
      {
        threadId: prepared.threadId,
        answer: result.answer,
        riskLevel: result.riskLevel,
        warningMessage: result.warningMessage,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (isGeminiQuotaError(error)) {
      return NextResponse.json(
        { error: error.message, retryAfterSeconds: error.retryAfterSeconds },
        { status: 429, headers: { "Retry-After": String(error.retryAfterSeconds) } },
      );
    }
    const code = error instanceof Error ? error.message : "";
    const status = code === "SENIOR_NOT_FOUND" || code === "THREAD_NOT_FOUND" ? 404 : code === "CARE_DATA_NOT_CONFIGURED" ? 503 : code.includes("GEMINI_API_KEY") ? 503 : 500;
    return NextResponse.json(
      { error: status === 404 ? "연결 정보나 대화 기록을 찾을 수 없습니다." : status === 503 ? "돌봄 AI 서비스가 아직 준비되지 않았습니다." : "답변을 만들지 못했습니다." },
      { status },
    );
  }
}
