/**
 * 안내 문구(frontend/guideNarration.ts)를 ElevenLabs로 미리 읽어 public/narration/에 저장한다.
 *
 *   npm run narration:guide
 *
 * - 서버 TTS와 같은 목소리·설정을 쓴다. 앞 목소리가 유료 전용(402)이면 다음 목소리로 넘어간다.
 *   그래서 요금제를 올린 뒤 다시 돌리면 Anna Kim 음성으로 바뀐다.
 * - 문구·목소리·설정이 같은 파일은 다시 만들지 않는다(크레딧 절약).
 * - 목록에서 빠진 예전 파일은 지운다.
 */
import { createHash } from "node:crypto";
import { mkdir, readdir, rm, writeFile, access } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getElevenLabsConfig } from "../backend/config/env.ts";
import { guideNarrationCopy, guideNarrationKey } from "../frontend/guideNarration.ts";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = join(projectRoot, "public", "narration");

const config = getElevenLabsConfig();
if (!config) {
  throw new Error("ELEVENLABS_API_KEY가 없습니다. .env.local에 키를 넣어 주세요.");
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function synthesize(text, voiceId, language) {
  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: {
        "xi-api-key": config.apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: config.model,
        language_code: language.split("-")[0],
        voice_settings: config.voiceSettings,
      }),
    },
  );
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    const error = new Error(`ElevenLabs ${response.status}: ${detail.slice(0, 200)}`);
    error.status = response.status;
    throw error;
  }
  return Buffer.from(await response.arrayBuffer());
}

const manifest = { voices: {}, entries: {} };
const keptFiles = new Set();
let generated = 0;
let reused = 0;
let characters = 0;

for (const [language, phrases] of Object.entries(guideNarrationCopy)) {
  const voices = config.voicesFor(language);
  if (voices.length === 0) {
    console.log(`- ${language}: 지정된 ElevenLabs 목소리가 없어 건너뜁니다.`);
    continue;
  }

  // 유료 전용 목소리를 문구마다 다시 시도하지 않도록, 처음 통과한 목소리를 이 언어에 고정한다.
  let usableVoices = voices;
  for (const text of new Set(Object.values(phrases))) {
    let saved = false;
    for (const voiceId of usableVoices) {
      const fingerprint = JSON.stringify([language, text, voiceId, config.model, config.voiceSettings]);
      const fileName = `${createHash("sha256").update(fingerprint).digest("hex").slice(0, 16)}.mp3`;
      const relativePath = `narration/${language}/${fileName}`;
      const absolutePath = join(outputRoot, language, fileName);

      if (!(await exists(absolutePath))) {
        try {
          const audio = await synthesize(text, voiceId, language);
          await mkdir(dirname(absolutePath), { recursive: true });
          await writeFile(absolutePath, audio);
          generated += 1;
          characters += text.length;
        } catch (error) {
          if (error.status === 402) {
            console.log(`- ${language}: 목소리 ${voiceId}는 유료 요금제 전용이라 다음 목소리로 넘어갑니다.`);
            usableVoices = usableVoices.filter((id) => id !== voiceId);
            continue;
          }
          throw error;
        }
      } else {
        reused += 1;
      }

      usableVoices = [voiceId];
      manifest.voices[language] = voiceId;
      manifest.entries[guideNarrationKey(language, text)] = relativePath;
      keptFiles.add(absolutePath);
      saved = true;
      break;
    }
    if (!saved) throw new Error(`${language}: 쓸 수 있는 ElevenLabs 목소리가 없습니다.`);
  }
}

// 문구가 바뀌거나 목소리가 바뀌어 더는 쓰지 않는 파일을 정리한다.
let removed = 0;
for (const language of await readdir(outputRoot).catch(() => [])) {
  const directory = join(outputRoot, language);
  if (!language.includes("-")) continue;
  for (const file of await readdir(directory)) {
    const path = join(directory, file);
    if (!keptFiles.has(path)) {
      await rm(path);
      removed += 1;
    }
  }
}

await mkdir(outputRoot, { recursive: true });
await writeFile(join(outputRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

console.log(
  `안내 음성: 새로 만듦 ${generated}개(${characters}자), 재사용 ${reused}개, 삭제 ${removed}개`,
);
console.log(`목소리: ${JSON.stringify(manifest.voices)}`);
