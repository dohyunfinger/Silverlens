import vinext from "vinext";
import { defineConfig } from "vite";
import { sites } from "./build/sites-vite-plugin";

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";

// SilverLens는 건강 정보를 서버에 저장하지 않고 브라우저(IndexedDB)에만 두므로
// D1·R2 바인딩을 쓰지 않는다. hosting.json에도 해당 항목이 없다.
const localBindingConfig = {
  // 기존 공개 주소(silverlens.ogq.workers.dev)의 Worker를 정확히 갱신한다.
  name: "silverlens",
  main: "./worker/index.ts",
  compatibility_flags: ["nodejs_compat", "nodejs_compat_populate_process_env"],
  // Firebase와 인증 관련 값을 Dashboard에서 관리하므로 재배포 때 보존한다.
  keep_vars: true,
  d1_databases: [
    {
      binding: "DB",
      database_name: "silverlens-care",
      database_id: "257ad117-3c31-4076-b430-29a40bbe2428",
      migrations_dir: "../.openai/drizzle",
    },
  ],
  r2_buckets: [],
};

export default defineConfig(async () => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    server: {
      host: "0.0.0.0",
      port: 3000,
      strictPort: true,
      allowedHosts: ["terminal.local"],
      ...(isCodexSeatbeltSandbox
        ? { watch: { useFsEvents: false, usePolling: true } }
        : {}),
    },
    plugins: [
      vinext(),
      sites(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        inspectorPort: false,
        config: localBindingConfig,
      }),
    ],
  };
});
