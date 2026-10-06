import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";
import ts from "typescript";

// Load the backend's bundler-style TypeScript and JSON imports in Node tests.
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith(".") && context.parentURL) {
      const file = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(file)) return { url: file.href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.endsWith(".ts")) {
      const source = ts.transpileModule(readFileSync(new URL(url), "utf8"), {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
      }).outputText;
      return { format: "module", source, shortCircuit: true };
    }
    if (url.endsWith(".json")) {
      return { format: "module", source: `export default ${readFileSync(new URL(url), "utf8")}`, shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

test("food-name questions reach the model on the first turn without a keyword refusal", async () => {
  const previousFetch = globalThis.fetch;
  const previousKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = "test-only-key";
  const requests = [];
  globalThis.fetch = async (_url, init) => {
    requests.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({
      answer: "음식에 대한 설명입니다.", summary: "음식을 설명해 드려요.", risk_level: "safe",
    }) }] } }] }), { status: 200 });
  };
  try {
    const { generateSeniorFriendlyAnswer } = await import("../backend/services/geminiService.ts");
    for (const question of ["푸아그라가 뭐야?", "라클렛이 뭐예요?", "What is foie gras?"]) {
      const before = requests.length;
      const result = await generateSeniorFriendlyAnswer(question);
      assert.equal(requests.length, before + 1);
      assert.ok(JSON.stringify(requests.at(-1)).includes(question));
      assert.equal(result.answer, "음식에 대한 설명입니다.");
    }
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousKey;
    hooks.deregister();
  }
});
