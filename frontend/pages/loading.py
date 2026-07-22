import streamlit as st

from components.header import show_header
from components.footer import show_footer
from components.big_button import show_big_button
from components.service_card import show_service_card


# -----------------------------
# 페이지 설정
# -----------------------------
st.set_page_config(
    page_title="AI 생활 도우미",
    layout="centered"
)


# -----------------------------
# Header
# -----------------------------
show_header("AI 생활 도우미")


# -----------------------------
# 안내 문구
# -----------------------------
st.markdown(
    """
    <div style="
        text-align:center;
        font-size:24px;
        padding-bottom:20px;
    ">
        무엇을 도와드릴까요?
    </div>
    """,
    unsafe_allow_html=True
)


# -----------------------------
# 질문하기 버튼
# -----------------------------
if show_big_button("질문하기"):
    st.switch_page("pages/loading.py")


st.write("")
st.subheader("자주 사용하는 기능")


# -----------------------------
# 서비스 카드
# -----------------------------
col1, col2 = st.columns(2)

with col1:

    if show_service_card(
        "🌤",
        "오늘 날씨",
        key="weather"
    ):
        st.write("날씨 기능")

    if show_service_card(
        "💊",
        "건강 정보",
        key="health"
    ):
        st.write("건강 기능")


with col2:

    if show_service_card(
        "🏥",
        "병원 찾기",
        key="hospital"
    ):
        st.write("병원 기능")

    if show_service_card(
        "📞",
        "가족 연락",
        key="call"
    ):
        st.write("가족 연락 기능")


st.write("")


# -----------------------------
# Footer
# -----------------------------
show_footer()