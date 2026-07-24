from io import BytesIO

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from faster_whisper import WhisperModel

app = FastAPI(title="SilverLens local STT")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["POST"],
    allow_headers=["*"],
)

model = WhisperModel("small", device="cpu", compute_type="int8")


@app.post("/transcribe")
async def transcribe(audio: UploadFile = File(...)):
    if not audio.content_type or not audio.content_type.startswith("audio/"):
        raise HTTPException(status_code=400, detail="음성 파일만 전송할 수 있습니다.")

    content = await audio.read()
    if not content:
        raise HTTPException(status_code=400, detail="빈 음성 파일입니다.")
    if len(content) > 20 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="음성 파일은 20MB 이하여야 합니다.")

    segments, info = model.transcribe(BytesIO(content), language="ko", vad_filter=True)
    text = " ".join(segment.text.strip() for segment in segments).strip()
    return {"text": text, "language": info.language}
