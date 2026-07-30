from __future__ import annotations

import csv
import os
from pathlib import Path
from threading import Lock
from typing import Any

import torch
import transformers
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field


MODEL_ID = os.getenv(
    "DIALECT_MODEL_ID",
    "sjbaek/gemma2-2b-it-korean-dialect",
)
PROJECT_ROOT = Path(__file__).resolve().parents[2]
# 사전 원본은 data/sources/ 로 옮겼다. 예전 경로도 함께 두어 구버전 체크아웃에서도 뜬다.
DATA_PATH_CANDIDATES = (
    PROJECT_ROOT / "data" / "sources" / "dialect_dictionary.csv",
    PROJECT_ROOT / "data" / "dialect_dictionary_source.csv",
)

app = FastAPI(title="SilverLens Local Dialect Normalizer")
app.add_middleware(
    CORSMiddleware,
    # 개발 중에는 vite(5173), vinext(3000) 등 포트가 자주 바뀌므로 로컬 호스트 전체를 허용한다.
    allow_origin_regex=r"^http://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


class NormalizeRequest(BaseModel):
    text: str = Field(min_length=1, max_length=2000)


class NormalizeResponse(BaseModel):
    original: str
    normalized: str
    model: str
    dictionary_hints: list[dict[str, str]]


_pipeline: Any | None = None
_model_lock = Lock()


def resolve_dictionary_path() -> Path | None:
    for candidate in DATA_PATH_CANDIDATES:
        if candidate.exists():
            return candidate
    return None


def load_dictionary() -> list[dict[str, str]]:
    entries: list[dict[str, str]] = []
    path = resolve_dictionary_path()
    if path is None:
        print(
            "[SilverLens] 사투리 사전을 찾지 못했습니다. 찾아본 경로: "
            + ", ".join(str(candidate) for candidate in DATA_PATH_CANDIDATES)
        )
        return entries

    # 사전 CSV는 사투리,표준어,지역,분류 네 칸이다. 분류는 서버에서 쓰지 않는다.
    with path.open(encoding="utf-8-sig", newline="") as source:
        rows = csv.reader(
            line
            for line in source
            if line.strip() and not line.lstrip().startswith("#")
        )
        for row in rows:
            if len(row) < 2:
                continue
            dialect = row[0].strip()
            standard = row[1].strip()
            region = row[2].strip() if len(row) >= 3 else "미상"
            # 한 글자 사투리는 오탐이 심해 프롬프트에서 제외한다(빌드 스크립트와 같은 기준).
            if len(dialect) < 2 or not standard or dialect == standard:
                continue
            entries.append(
                {
                    "dialect": dialect,
                    "standard": standard,
                    "region": region,
                }
            )

    print(f"[SilverLens] 사투리 사전 {len(entries)}개를 {path.name} 에서 읽었습니다.")
    return entries


DICTIONARY_PATH = resolve_dictionary_path()
DIALECT_DICTIONARY = load_dictionary()


def get_pipeline() -> Any:
    global _pipeline
    if _pipeline is not None:
        return _pipeline

    with _model_lock:
        if _pipeline is None:
            tokenizer = transformers.AutoTokenizer.from_pretrained(
                MODEL_ID,
                add_eos_token=True,
            )
            _pipeline = transformers.pipeline(
                "text-generation",
                model=MODEL_ID,
                tokenizer=tokenizer,
                torch_dtype=torch.float16,
                device_map="auto",
            )
    return _pipeline


def find_dictionary_hints(text: str, limit: int = 20) -> list[dict[str, str]]:
    matches: list[dict[str, str]] = []
    seen: set[tuple[str, str]] = set()
    for entry in sorted(
        DIALECT_DICTIONARY,
        key=lambda item: len(item["dialect"]),
        reverse=True,
    ):
        dialect = entry["dialect"]
        key = (dialect, entry["standard"])
        if len(dialect) < 2 or dialect not in text or key in seen:
            continue
        seen.add(key)
        matches.append(entry)
        if len(matches) >= limit:
            break
    return matches


def extract_content(result: Any) -> str:
    generated = result[0].get("generated_text") if result else None
    if isinstance(generated, list):
        for message in reversed(generated):
            if isinstance(message, dict) and message.get("role") == "assistant":
                return str(message.get("content", "")).strip()
    if isinstance(generated, str):
        return generated.strip()
    return ""


@app.get("/health")
def health() -> dict[str, object]:
    return {
        "status": "ok",
        "model": MODEL_ID,
        "model_loaded": _pipeline is not None,
        "dictionary_entries": len(DIALECT_DICTIONARY),
        "dictionary_path": str(DICTIONARY_PATH) if DICTIONARY_PATH else None,
    }


@app.post("/normalize", response_model=NormalizeResponse)
def normalize(request: NormalizeRequest) -> NormalizeResponse:
    original = request.text.strip()
    hints = find_dictionary_hints(original)
    prompt = [
        "다음 한국어 방언 문장을 뜻을 바꾸지 말고 자연스러운 표준 한국어로 변환하세요.",
        "식품명, 질병명, 알레르기명은 삭제하거나 다른 말로 바꾸지 마세요.",
        "설명이나 추가 답변 없이 변환된 문장만 출력하세요.",
        f"방언 사전 참고: {hints}",
        f"방언 문장: {original}",
    ]
    messages = [{"role": "user", "content": "\n".join(prompt)}]

    try:
        result = get_pipeline()(
            messages,
            do_sample=False,
            max_new_tokens=256,
            add_special_tokens=True,
        )
    except Exception as error:
        raise HTTPException(
            status_code=503,
            detail=f"방언 모델을 실행하지 못했습니다: {error}",
        ) from error

    normalized = extract_content(result)
    for prefix in ("표준어:", "변환 결과:", "assistant"):
        if normalized.startswith(prefix):
            normalized = normalized[len(prefix) :].strip()
    normalized = normalized.strip("\"' \n")
    if not normalized:
        raise HTTPException(status_code=500, detail="방언 모델이 빈 결과를 반환했습니다.")

    return NormalizeResponse(
        original=original,
        normalized=normalized,
        model=MODEL_ID,
        dictionary_hints=hints,
    )
