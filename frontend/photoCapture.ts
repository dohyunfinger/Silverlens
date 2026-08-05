/**
 * 어르신이 찍은 사진을 보내기 전에 브라우저에서 손질하는 모듈.
 *
 * 하는 일은 두 가지다.
 * 1) 장변을 PHOTO_MAX_EDGE 로 줄인다. 요즘 폰 사진은 4000px가 넘어 그대로 보내면
 *    업로드가 오래 걸리는데, Gemini Vision 은 어차피 타일 단위로 잘라 보므로
 *    1568px 를 넘겨도 글자가 더 잘 읽히지는 않는다.
 * 2) 밝기와 흔들림을 재서 "너무 어두워요" / "흐릿해요" 를 미리 알려 준다.
 *    성분표처럼 글자를 읽어야 하는 사진은 흔들리면 모델이 엉뚱한 글자를 읽어
 *    잘못된 안내로 이어지므로, 보내기 전에 다시 찍을 기회를 준다.
 *
 * 판정은 어디까지나 참고용 경고다. 어르신이 그대로 보내겠다고 하면 막지 않는다.
 */

/** Gemini Vision 이 한 장을 처리하는 데 충분한 장변 길이. */
export const PHOTO_MAX_EDGE = 1568;

/** 이 값보다 어두우면 "어둡다"고 본다(평균 밝기, 0~255). */
const DARK_MEAN_LUMA = 62;
/** 이 값보다 밝으면 빛 번짐으로 글자가 날아갔다고 본다. */
const BRIGHT_MEAN_LUMA = 218;
/**
 * 라플라시안 분산이 이 값보다 작으면 "흐릿하다"고 본다.
 * 어르신에게 다시 찍으라고 하는 건 부담이므로, 확실히 흐린 경우만 걸리도록
 * 낮게 잡았다(선명한 사진은 보통 수백 이상 나온다).
 */
const BLURRY_LAPLACIAN_VARIANCE = 38;
/** 밝기·흔들림을 잴 때 쓰는 축소본의 장변. 작게 재야 빠르고 노이즈에 덜 흔들린다. */
const QUALITY_SAMPLE_EDGE = 180;

export type PhotoIssue = "dark" | "bright" | "blurry";

export type PhotoQuality = {
  /** 평균 밝기 0~255. 잴 수 없었으면 null. */
  meanLuma: number | null;
  /** 라플라시안 분산. 클수록 선명하다. 잴 수 없었으면 null. */
  sharpness: number | null;
  /** 걸린 문제들. 비어 있으면 그대로 보내도 괜찮다는 뜻. */
  issues: PhotoIssue[];
};

export type PreparedPhoto = {
  /** 실제로 서버에 보낼 파일(줄였으면 줄인 것, 못 줄였으면 원본). */
  file: File;
  /** 미리보기용 objectURL. 다 쓰면 반드시 URL.revokeObjectURL 로 정리한다. */
  url: string;
  width: number;
  height: number;
  /** 줄이기·검사를 못 했으면 false. 이때 quality.issues 는 빈 배열이다. */
  processed: boolean;
  quality: PhotoQuality;
};

const EMPTY_QUALITY: PhotoQuality = { meanLuma: null, sharpness: null, issues: [] };

/**
 * 파일을 그릴 수 있는 형태로 읽는다.
 * createImageBitmap 이 되는 브라우저가 대부분이지만, HEIC 처럼 브라우저가 못 읽는
 * 형식이면 여기서 실패한다. 그때는 원본을 그대로 보낸다.
 */
async function decodeImage(file: File): Promise<ImageBitmap | HTMLImageElement | null> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file);
    } catch {
      // 아래 <img> 경로로 한 번 더 시도한다.
    }
  }
  if (typeof Image !== "function" || typeof URL?.createObjectURL !== "function") {
    return null;
  }
  const objectUrl = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("이미지를 읽지 못했습니다."));
      element.src = objectUrl;
    });
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function sourceSize(source: ImageBitmap | HTMLImageElement) {
  const width =
    "naturalWidth" in source ? source.naturalWidth || source.width : source.width;
  const height =
    "naturalHeight" in source ? source.naturalHeight || source.height : source.height;
  return { width, height };
}

function createCanvas(width: number, height: number): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

/**
 * 절반씩 줄여 가며 그린다. 4000px 를 1568px 로 한 번에 줄이면 픽셀을 건너뛰어
 * 작은 글자가 뭉개지는데, 두 배 이내로 여러 번 줄이면 글자가 살아남는다.
 */
function drawScaled(
  source: ImageBitmap | HTMLImageElement,
  targetWidth: number,
  targetHeight: number,
): HTMLCanvasElement | null {
  const { width, height } = sourceSize(source);
  let currentCanvas = createCanvas(width, height);
  if (!currentCanvas) return null;
  const context = currentCanvas.getContext("2d");
  if (!context) return null;
  context.drawImage(source, 0, 0, width, height);

  let currentWidth = width;
  let currentHeight = height;
  while (currentWidth > targetWidth * 2 && currentHeight > targetHeight * 2) {
    const nextCanvas = createCanvas(currentWidth / 2, currentHeight / 2);
    const nextContext = nextCanvas?.getContext("2d");
    if (!nextCanvas || !nextContext) break;
    nextContext.imageSmoothingEnabled = true;
    nextContext.imageSmoothingQuality = "high";
    nextContext.drawImage(currentCanvas, 0, 0, nextCanvas.width, nextCanvas.height);
    currentCanvas = nextCanvas;
    currentWidth = nextCanvas.width;
    currentHeight = nextCanvas.height;
  }

  if (currentWidth === targetWidth && currentHeight === targetHeight) {
    return currentCanvas;
  }
  const finalCanvas = createCanvas(targetWidth, targetHeight);
  const finalContext = finalCanvas?.getContext("2d");
  if (!finalCanvas || !finalContext) return currentCanvas;
  finalContext.imageSmoothingEnabled = true;
  finalContext.imageSmoothingQuality = "high";
  finalContext.drawImage(currentCanvas, 0, 0, finalCanvas.width, finalCanvas.height);
  return finalCanvas;
}

/**
 * RGBA 픽셀 배열에서 평균 밝기와 라플라시안 분산을 구해 판정한다.
 * 캔버스와 분리해 둔 순수 함수라서 브라우저 없이도 검증할 수 있다.
 *
 * 라플라시안 분산은 초점이 맞았는지 보는 표준적인 방법이다. 경계가 뚜렷하면
 * 값이 크고, 흔들리거나 초점이 빗나가면 경계가 뭉개져 값이 작아진다.
 */
export function analyzeRgbaPixels(
  pixels: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
): PhotoQuality {
  if (width < 3 || height < 3 || pixels.length < width * height * 4) {
    return EMPTY_QUALITY;
  }
  const gray = new Float32Array(width * height);
  let lumaSum = 0;
  for (let index = 0; index < gray.length; index += 1) {
    const offset = index * 4;
    // ITU-R BT.601 밝기 가중치.
    const luma =
      0.299 * pixels[offset] + 0.587 * pixels[offset + 1] + 0.114 * pixels[offset + 2];
    gray[index] = luma;
    lumaSum += luma;
  }
  const meanLuma = lumaSum / gray.length;

  let laplacianSum = 0;
  let laplacianSquareSum = 0;
  let laplacianCount = 0;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const center = y * width + x;
      const value =
        gray[center - width] +
        gray[center + width] +
        gray[center - 1] +
        gray[center + 1] -
        4 * gray[center];
      laplacianSum += value;
      laplacianSquareSum += value * value;
      laplacianCount += 1;
    }
  }
  const sharpness =
    laplacianCount > 0
      ? laplacianSquareSum / laplacianCount - (laplacianSum / laplacianCount) ** 2
      : null;

  const issues: PhotoIssue[] = [];
  if (meanLuma < DARK_MEAN_LUMA) issues.push("dark");
  else if (meanLuma > BRIGHT_MEAN_LUMA) issues.push("bright");
  if (sharpness !== null && sharpness < BLURRY_LAPLACIAN_VARIANCE) issues.push("blurry");

  return { meanLuma, sharpness, issues };
}

/** 캔버스를 작게 줄여 흑백 분석에 넘긴다. 작게 재야 빠르고 노이즈에 덜 흔들린다. */
function measureQuality(canvas: HTMLCanvasElement): PhotoQuality {
  const scale = Math.min(1, QUALITY_SAMPLE_EDGE / Math.max(canvas.width, canvas.height));
  const sampleWidth = Math.max(8, Math.round(canvas.width * scale));
  const sampleHeight = Math.max(8, Math.round(canvas.height * scale));
  const sampleCanvas = createCanvas(sampleWidth, sampleHeight);
  const sampleContext = sampleCanvas?.getContext("2d", { willReadFrequently: true });
  if (!sampleCanvas || !sampleContext) return EMPTY_QUALITY;
  sampleContext.drawImage(canvas, 0, 0, sampleWidth, sampleHeight);

  try {
    const pixels = sampleContext.getImageData(0, 0, sampleWidth, sampleHeight).data;
    return analyzeRgbaPixels(pixels, sampleWidth, sampleHeight);
  } catch {
    // 다른 출처 이미지라 캔버스가 오염된 경우. 검사만 건너뛴다.
    return EMPTY_QUALITY;
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    if (typeof canvas.toBlob !== "function") {
      resolve(null);
      return;
    }
    canvas.toBlob((blob) => resolve(blob), "image/jpeg", quality);
  });
}

function replaceExtension(name: string) {
  const base = name.replace(/\.[^.]+$/, "").trim();
  return `${base || "photo"}.jpg`;
}

/**
 * 사진을 줄이고 상태를 재서 돌려준다.
 * 캔버스를 못 쓰거나 브라우저가 못 읽는 형식이면 원본을 그대로 담아 돌려주므로,
 * 이 함수가 실패해서 사진을 못 보내는 경우는 없다.
 */
export async function preparePhoto(file: File): Promise<PreparedPhoto> {
  const fallback = (): PreparedPhoto => ({
    file,
    url: URL.createObjectURL(file),
    width: 0,
    height: 0,
    processed: false,
    quality: EMPTY_QUALITY,
  });

  let source: ImageBitmap | HTMLImageElement | null = null;
  try {
    source = await decodeImage(file);
    if (!source) return fallback();
    const { width, height } = sourceSize(source);
    if (!width || !height) return fallback();

    const scale = Math.min(1, PHOTO_MAX_EDGE / Math.max(width, height));
    const targetWidth = Math.max(1, Math.round(width * scale));
    const targetHeight = Math.max(1, Math.round(height * scale));
    const canvas = drawScaled(source, targetWidth, targetHeight);
    if (!canvas) return fallback();

    const quality = measureQuality(canvas);
    const blob = await canvasToBlob(canvas, 0.85);
    // 이미 작은 사진이면 다시 인코딩해서 오히려 커질 수 있으니 원본을 쓴다.
    const useOriginal = !blob || (scale === 1 && blob.size >= file.size);
    const outputFile = useOriginal
      ? file
      : new File([blob], replaceExtension(file.name), {
          type: "image/jpeg",
          lastModified: Date.now(),
        });
    return {
      file: outputFile,
      url: URL.createObjectURL(outputFile),
      width: canvas.width,
      height: canvas.height,
      processed: true,
      quality,
    };
  } catch {
    return fallback();
  } finally {
    if (source && "close" in source && typeof source.close === "function") {
      source.close();
    }
  }
}
