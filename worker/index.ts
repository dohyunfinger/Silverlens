/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { syncMfdsPillCatalog, type D1Database } from "../backend/services/mfdsPillData";

// @cloudflare/workers-types 를 설치하지 않아 Fetcher 전역 타입이 없다.
// 여기서 쓰는 것은 fetch 하나뿐이라 필요한 만큼만 직접 선언한다.
type AssetFetcher = { fetch(request: Request): Promise<Response> };

// 연결 데이터와 공식 낱알 카탈로그는 D1에 저장하고, 키는 Secret으로만 받는다.
interface Env {
  ASSETS: AssetFetcher;
  DB?: D1Database;
  MFDS_DATA_API_KEY?: string;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    return handler.fetch(request, env, ctx);
  },

  async scheduled(
    _controller: unknown,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    ctx.waitUntil(
      syncMfdsPillCatalog(env).then((result) => {
        console.log("[SilverLens] MFDS catalog sync", {
          status: result.status,
          reason: result.reason,
          recordsSynced: result.recordsSynced,
          totalCount: result.totalCount,
          nextPage: result.nextPage,
        });
      }).catch((error) => {
        console.error(
          "[SilverLens] MFDS catalog sync failed",
          error instanceof Error ? error.message : error,
        );
      }),
    );
  },
};

export default worker;
