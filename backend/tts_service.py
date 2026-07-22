from __future__ import annotations

import base64
import io
import wave

from google import genai


TTS_MODEL = "gemini-2.5-flash-preview-tts"
TTS_VOICE = "Sulafat"


class TTSServiceError(Exception):
    """Gemini TTS 처리 중 발생하는 오류."""


def _pcm_to_wav_bytes(
    pcm_data: bytes,
    channels: int = 1,
    sample_rate: int = 24000,
    sample_width: int = 2,
) -> bytes:
    """Gemini가 반환한 PCM 데이터를 WAV 바이트로 변환한다."""

    wav_buffer = io.BytesIO()

    with wave.open(wav_buffer, "wb") as wav_file:
        wav_file.setnchannels(channels)
        wav_file.setsampwidth(sample_width)
        wav_file.setframerate(sample_rate)
        wav_file.writeframes(pcm_data)

    return wav_buffer.getvalue()


def generate_speech(
    api_key: str,
    text: str,
) -> bytes:
    """텍스트를 시니어 친화적인 한국어 WAV 음성으로 변환한다."""

    cleaned_text = text.strip()

    if not cleaned_text:
        raise ValueError("음성으로 읽을 내용이 비어 있습니다.")

    if not api_key or not api_key.strip():
        raise TTSServiceError("Gemini API 키가 없습니다.")

    narration_prompt = f"""
다음 한국어 문장을 그대로 읽으세요.

말하기 지침:
- 시니어 사용자가 듣기 편하도록 천천히 말합니다.
- 차분하고 따뜻한 말투를 사용합니다.
- 식재료 이름과 숫자를 또렷하게 발음합니다.
- 내용을 요약하거나 바꾸지 않습니다.
- 추가 설명을 하지 않습니다.

읽을 문장:
{cleaned_text}
""".strip()

    try:
        client = genai.Client(api_key=api_key)

        interaction = client.interactions.create(
            model=TTS_MODEL,
            input=narration_prompt,
            response_format={"type": "audio"},
            generation_config={
                "speech_config": [
                    {
                        "voice": TTS_VOICE,
                    }
                ]
            },
        )

        output_audio = getattr(interaction, "output_audio", None)

        if output_audio is None:
            raise TTSServiceError(
                "Gemini TTS가 음성 데이터를 반환하지 않았습니다."
            )

        encoded_audio = getattr(output_audio, "data", None)

        if not encoded_audio:
            raise TTSServiceError(
                "Gemini TTS 음성 데이터가 비어 있습니다."
            )

        pcm_data = base64.b64decode(encoded_audio)

        return _pcm_to_wav_bytes(pcm_data)

    except TTSServiceError:
        raise

    except Exception as error:
        raise TTSServiceError(
            f"Gemini TTS 호출 중 오류가 발생했습니다: {error}"
        ) from error