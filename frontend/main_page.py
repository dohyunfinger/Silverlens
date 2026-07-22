from __future__ import annotations

import streamlit as st

from backend.ai_service import (
    AIServiceError,
    generate_response,
)
from backend.dialect_service import (
    DialectServiceError,
    normalize_dialect,
)
from backend.faster_whisper_service import FasterWhisperError
from backend.stt_service import (
    STTServiceError,
    transcribe_audio,
)
from backend.tts_service import (
    TTSServiceError,
    generate_speech,
)
from frontend.components.backup_browser_tts import (
    render_backup_browser_tts,
)

def get_gemini_api_key() -> str:
    """Streamlit secrets에서 Gemini API 키를 읽는다."""

    try:
        api_key = str(
            st.secrets["GEMINI_API_KEY"]
        ).strip()
    except KeyError as error:
        raise KeyError(
            ".streamlit/secrets.toml에 "
            "GEMINI_API_KEY가 설정되어 있지 않습니다."
        ) from error
    except FileNotFoundError as error:
        raise FileNotFoundError(
            ".streamlit/secrets.toml 파일을 찾을 수 없습니다."
        ) from error

    if not api_key:
        raise KeyError(
            "GEMINI_API_KEY 값이 비어 있습니다."
        )

    return api_key


def render_main_page() -> None:
    st.title("SilverLens AI 프로젝트")
    st.caption("시니어 식품 음성 도우미")

    st.divider()

    # ---------------------------------
    # 1단계: 음성 녹음 및 STT
    # ---------------------------------
    st.subheader("1. 음성으로 질문하기")

    audio_file = st.audio_input(
        "마이크 버튼을 누르고 질문해 주세요.",
        sample_rate=16000,
    )

    if audio_file is not None:
        st.audio(audio_file)

        if st.button(
            "음성 인식하기",
            type="primary",
            use_container_width=True,
        ):
            try:
                with st.spinner(
                    "음성을 알아듣고 있어요..."
                ):
                    transcript = transcribe_audio(
                        audio_bytes=audio_file.getvalue(),
                    )

                st.session_state["recognized_text"] = transcript

                # 새 녹음을 인식했다면 이전 해석과 답변은 초기화
                st.session_state.pop(
                    "normalized_text",
                    None,
                )
                st.session_state.pop(
                    "last_answer",
                    None,
                )

                st.success("음성인식이 완료되었습니다.")

            except (
                FasterWhisperError,
                STTServiceError,
            ) as error:
                st.error(str(error))

            except ValueError as error:
                st.warning(str(error))

            except Exception as error:
                st.error(
                    "예상하지 못한 음성인식 오류가 "
                    f"발생했습니다: {error}"
                )

    recognized_text = st.session_state.get(
        "recognized_text",
        "",
    )

    if recognized_text:
        st.markdown("#### 음성인식 원문")
        st.info(recognized_text)

    st.divider()

    # ---------------------------------
    # 2단계: 사투리 표준어 변환
    # ---------------------------------
    st.subheader("2. 사투리 해석하기")

    transcript_input = st.text_area(
        "음성인식 결과를 확인하거나 수정하세요.",
        value=recognized_text,
        placeholder=(
            "예: 물텀벙은 어떵 손질하는 거우꽈?"
        ),
        height=120,
        key="transcript_input",
    )

    if st.button(
        "사투리를 표준어로 해석하기",
        use_container_width=True,
        disabled=not transcript_input.strip(),
    ):
        try:
            api_key = get_gemini_api_key()

            with st.spinner(
                "사투리의 의미를 확인하고 있어요..."
            ):
                normalized_text = normalize_dialect(
                    api_key=api_key,
                    transcript=transcript_input,
                )

            st.session_state[
                "normalized_text"
            ] = normalized_text

            st.session_state.pop(
                "last_answer",
                None,
            )

            st.success("사투리 해석이 완료되었습니다.")

        except (
            KeyError,
            FileNotFoundError,
        ) as error:
            st.error(str(error))

        except ValueError as error:
            st.warning(str(error))

        except DialectServiceError as error:
            st.error(str(error))

        except Exception as error:
            st.error(
                "예상하지 못한 사투리 해석 오류가 "
                f"발생했습니다: {error}"
            )

    normalized_text = st.session_state.get(
        "normalized_text",
        "",
    )

    if normalized_text:
        st.markdown("#### 표준어 해석 결과")
        st.info(normalized_text)

    st.divider()

    # ---------------------------------
    # 3단계: Gemini 식품 답변
    # ---------------------------------
    st.subheader("3. 식품 질문 답변받기")

    default_question = (
        normalized_text
        if normalized_text
        else transcript_input
    )

    final_question = st.text_area(
        "Gemini에 전달할 최종 질문을 확인하세요.",
        value=default_question,
        placeholder=(
            "예: 물텀벙은 어떻게 손질하나요?"
        ),
        height=120,
        key="final_question_input",
    )

    if st.button(
        "Gemini에게 질문하기",
        use_container_width=True,
        disabled=not final_question.strip(),
    ):
        try:
            api_key = get_gemini_api_key()

            with st.spinner(
                "식품 관련 답변을 준비하고 있어요..."
            ):
                result = generate_response(
                    api_key=api_key,
                    user_input=final_question,
                )

            st.session_state["last_answer"] = result
            st.success("답변 생성이 완료되었습니다.")

        except (
            KeyError,
            FileNotFoundError,
        ) as error:
            st.error(str(error))

        except ValueError as error:
            st.warning(str(error))

        except AIServiceError as error:
            st.error(str(error))

        except Exception as error:
            st.error(
                "예상하지 못한 답변 생성 오류가 "
                f"발생했습니다: {error}"
            )


    last_answer = st.session_state.get(
        "last_answer",
        "",
    )

    if last_answer:
        st.markdown("#### Gemini 답변")
        st.success(last_answer)

        st.markdown("#### 답변 음성으로 듣기")

        if st.button(
            "Gemini 음성 만들기",
            use_container_width=True,
        ):
            try:
                api_key = get_gemini_api_key()

                with st.spinner(
                    "듣기 편한 음성을 만들고 있어요..."
                ):
                    audio_bytes = generate_speech(
                        api_key=api_key,
                        text=last_answer,
                    )

                st.session_state["answer_audio"] = audio_bytes
                st.session_state["tts_fallback_required"] = False

            except (
                TTSServiceError,
                ValueError,
            ) as error:
                st.session_state["tts_fallback_required"] = True

                st.warning(
                    "Gemini 음성 서비스를 현재 사용할 수 없습니다. "
                    "무료 백업 음성 기능을 사용해 주세요."
                )

                st.caption(str(error))

        answer_audio = st.session_state.get(
            "answer_audio",
        )

        if answer_audio:
            st.audio(
                answer_audio,
                format="audio/wav",
            )

        if st.session_state.get(
            "tts_fallback_required",
            False,
        ):
            # BACKUP: Gemini TTS 실패 시에만 표시
            render_backup_browser_tts(
                text=last_answer,
                button_label="백업 음성으로 듣기",
            )