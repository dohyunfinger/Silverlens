import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const defaultProjectRoot = resolve(scriptDirectory, "..");

async function requireFile(path, description) {
  try {
    await access(path);
  } catch {
    throw new Error(`Missing ${description}: ${path}`);
  }
}

export async function validateArtifact(projectRoot = defaultProjectRoot) {
  const workerPath = resolve(projectRoot, "dist", "server", "index.js");
  const hostingPath = resolve(projectRoot, "dist", ".openai", "hosting.json");
  const wranglerPath = resolve(projectRoot, "dist", "server", "wrangler.json");
  const deployRedirectPath = resolve(projectRoot, ".wrangler", "deploy", "config.json");

  await Promise.all([
    requireFile(workerPath, "Worker entry"),
    requireFile(hostingPath, "Sites manifest"),
    requireFile(wranglerPath, "generated Wrangler configuration"),
    requireFile(deployRedirectPath, "Wrangler deployment redirect"),
  ]);

  const hosting = JSON.parse(await readFile(hostingPath, "utf8"));
  if (!hosting.project_id) {
    throw new Error("dist/.openai/hosting.json must contain project_id.");
  }

  const wrangler = JSON.parse(await readFile(wranglerPath, "utf8"));
  const configuredWorker = resolve(dirname(wranglerPath), wrangler.main || "");
  const configuredAssets = resolve(dirname(wranglerPath), wrangler.assets?.directory || "");
  if (wrangler.name !== "silverlens") {
    throw new Error("Generated Wrangler configuration must target the existing silverlens Worker.");
  }
  if (!wrangler.compatibility_flags?.includes("nodejs_compat_populate_process_env")) {
    throw new Error("Generated Wrangler configuration must expose Worker bindings through process.env.");
  }
  if (configuredWorker !== workerPath) {
    throw new Error("Generated Wrangler configuration does not point to dist/server/index.js.");
  }
  if (wrangler.keep_vars !== true) {
    throw new Error("Generated Wrangler configuration must preserve dashboard environment variables.");
  }
  await requireFile(configuredAssets, "client assets directory");

  const redirect = JSON.parse(await readFile(deployRedirectPath, "utf8"));
  const redirectedConfig = resolve(dirname(deployRedirectPath), redirect.configPath || "");
  if (redirectedConfig !== wranglerPath) {
    throw new Error("Wrangler deployment redirect does not point to the generated configuration.");
  }

  const workerSource = await readFile(workerPath, "utf8");
  if (workerSource.includes('from "cloudflare:workers"')) {
    // A D1-backed Worker legitimately imports Cloudflare's runtime-only env
    // module. Node's default loader cannot import that protocol, so validate
    // the generated entry statically while keeping the stronger runtime probe
    // for artifacts that contain only Node-loadable modules.
    const hasDefaultExport = /export\s*\{[^}]*\bas\s+default\b[^}]*\}/s.test(workerSource);
    const hasFetchHandler = /async\s+fetch\s*\(request,\s*env,\s*ctx\)/.test(workerSource);
    if (!hasDefaultExport || !hasFetchHandler) {
      throw new Error("dist/server/index.js must export default.fetch(request, env, ctx).");
    }
  } else {
    const workerUrl = pathToFileURL(workerPath);
    workerUrl.searchParams.set("artifact-validation", `${process.pid}-${Date.now()}`);
    const worker = await import(workerUrl.href);
    if (!worker.default || typeof worker.default.fetch !== "function") {
      throw new Error("dist/server/index.js must export default.fetch(request, env, ctx).");
    }
  }

  console.log("Validated Worker artifact, assets, Sites manifest, and Wrangler deploy configuration.");
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (invokedPath === import.meta.url) {
  validateArtifact().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
