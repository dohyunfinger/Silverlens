from __future__ import annotations

import html
import json

import streamlit.components.v1 as components


# ============================================================
# BACKUP COMPONENT
# Gemini TTS가 무료 한도 초과, 429, 503 등의 이유로 실패할 때만 사용.
#
# Gemini TTS가 안정화되면:
# 1. 이 파일을 삭제하고
# 2. main_page.py의 render_backup_browser_tts() 호출을 삭제하면 됨.
# ============================================================


def render_backup_browser_tts(
    text: str,
    button_label: str = "브라우저 음성으로 듣기",
) -> None:
    """브라우저 Web Speech API를 사용해 한국어 문장을 읽는다."""

    cleaned_text = text.strip()

    if not cleaned_text:
        return

    safe_text_json = json.dumps(cleaned_text, ensure_ascii=False)
    safe_label = html.escape(button_label)

    components.html(
        f"""
        <div>
            <button
                id="backup-tts-button"
                style="
                    width: 100%;
                    padding: 12px;
                    border: none;
                    border-radius: 8px;
                    cursor: pointer;
                    font-size: 16px;
                "
            >
                🔊 {safe_label}
            </button>
        </div>

        <script>
            const button = document.getElementById(
                "backup-tts-button"
            );

            button.addEventListener("click", () => {{
                window.speechSynthesis.cancel();

                const utterance = new SpeechSynthesisUtterance(
                    {safe_text_json}
                );

                utterance.lang = "ko-KR";
                utterance.rate = 0.85;
                utterance.pitch = 1.0;
                utterance.volume = 1.0;

                const voices = window.speechSynthesis.getVoices();
                const koreanVoice = voices.find(
                    voice => voice.lang.startsWith("ko")
                );

                if (koreanVoice) {{
                    utterance.voice = koreanVoice;
                }}

                window.speechSynthesis.speak(utterance);
            }});
        </script>
        """,
        height=70,
    )