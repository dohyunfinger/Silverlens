import streamlit as st

from backend.ai_service import generate_response


def render_main_page() -> None:
    st.title("SilverLens AI 프로젝트")
    st.caption("웹사이트 연결 테스트")

    st.divider()

    user_input = st.text_area(
        "내용을 입력하세요.",
        placeholder="예: 테스트 문장을 입력하세요.",
        height=150,
    )

    if st.button("실행", use_container_width=True):
        try:
            result = generate_response(user_input)
            st.success("백엔드 연결 성공")
            st.write(result)

        except ValueError as error:
            st.warning(str(error))

        except Exception:
            st.error("처리 중 오류가 발생했습니다.")