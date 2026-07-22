import streamlit as st

from components.header import show_header
from components.answer_card import show_answer_card
from components.big_button import show_big_button
from components.footer import show_footer


# -----------------------------
# 페이지 설정
# -----------------------------
st.set_page_config(
    page_title="AI 답변",
    layout="centered"
)

# -----------------------------
# Header
# -----------------------------
show_header("AI 답변")

# -----------------------------
# 임시 답변
# (나중에는 GPT 응답으로 변경)
# -----------------------------
answer = """
오늘은 오후에 비가 올 예정입니다.

외출하실 때
우산을 챙기세요.

좋은 하루 보내세요.
"""

# -----------------------------
# 답변 카드
# -----------------------------
show_answer_card(answer)

st.write("")

# -----------------------------
# 버튼
# -----------------------------
col1, col2 = st.columns(2)

with col1:
    show_big_button("다시 질문")

with col2:
    show_big_button("처음으로")

st.write("")

# -----------------------------
# Footer
# -----------------------------
show_footer()