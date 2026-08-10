import { spawn } from "node:child_process";
import { access, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { validateArtifact } from "./validate-artifact.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, "..");
const runtimeRoot = process.env.SITES_RUNTIME_ROOT
  ? resolve(process.env.SITES_RUNTIME_ROOT)
  : resolve(projectRoot, ".sites-runtime");

function parseDuration(value, fallback) {
  if (!value) return fallback;

  const match = /^(\d+(?:\.\d+)?)(ms|s|m|h)?$/i.exec(value.trim());
  if (!match) {
    throw new Error(`Invalid duration "${value}". Use values such as 500ms, 10s, 3m, or 1h.`);
  }

  const units = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000 };
  return Number(match[1]) * units[(match[2] || "ms").toLowerCase()];
}

async function runBuild() {
  const runtimeDirectories = {
    cache: resolve(runtimeRoot, "npm-cache"),
    logs: resolve(runtimeRoot, "wrangler", "logs"),
    registry: resolve(runtimeRoot, "wrangler", "registry"),
    temp: resolve(runtimeRoot, "tmp"),
  };

  await Promise.all(Object.values(runtimeDirectories).map((path) => mkdir(path, { recursive: true })));

  const vinextCli = resolve(projectRoot, "node_modules", "vinext", "dist", "cli.js");
  try {
    await access(vinextCli);
  } catch {
    throw new Error("vinext is unavailable. Run npm install before building.");
  }

  const timeoutMs = parseDuration(process.env.SITES_BUILD_TIMEOUT, 3 * 60_000);
  const killAfterMs = parseDuration(process.env.SITES_BUILD_KILL_AFTER, 10_000);
  const environment = {
    ...process.env,
    SITES_ENV_READY: "1",
    SITES_PROJECT_ROOT: projectRoot,
    WRANGLER_WRITE_LOGS: process.env.WRANGLER_WRITE_LOGS || "false",
    WRANGLER_LOG_PATH: process.env.WRANGLER_LOG_PATH || runtimeDirectories.logs,
    MINIFLARE_REGISTRY_PATH: process.env.MINIFLARE_REGISTRY_PATH || runtimeDirectories.registry,
    npm_config_cache: process.env.npm_config_cache || runtimeDirectories.cache,
    npm_config_audit: process.env.npm_config_audit || "false",
    npm_config_fund: process.env.npm_config_fund || "false",
    npm_config_update_notifier: process.env.npm_config_update_notifier || "false",
  };

  console.log("Running cross-platform bounded vinext build...");
  const child = spawn(process.execPath, [vinextCli, "build"], {
    cwd: projectRoot,
    env: environment,
    stdio: "inherit",
    windowsHide: true,
  });

  let timedOut = false;
  let forceKillTimer;
  const timeoutTimer = setTimeout(() => {
    timedOut = true;
    console.error(`Build exceeded ${timeoutMs}ms; stopping it.`);
    child.kill("SIGTERM");
    forceKillTimer = setTimeout(() => child.kill("SIGKILL"), killAfterMs);
    forceKillTimer.unref();
  }, timeoutMs);
  timeoutTimer.unref();

  const exitCode = await new Promise((resolveExit, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal && !timedOut) {
        reject(new Error(`vinext build stopped by ${signal}.`));
        return;
      }
      resolveExit(code ?? 1);
    });
  });

  clearTimeout(timeoutTimer);
  if (forceKillTimer) clearTimeout(forceKillTimer);
  if (timedOut) throw new Error("vinext build timed out.");
  if (exitCode !== 0) throw new Error(`vinext build failed with exit code ${exitCode}.`);

  await validateArtifact(projectRoot);
}

runBuild().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
