import streamlit as st

from frontend.main_page import render_main_page


def main() -> None:
    st.set_page_config(
        page_title="작품명:SilverLens 팀명:우승 예 동의합니다",
        page_icon="✅",
        layout="wide",
    )

    render_main_page()


if __name__ == "__main__":
    main(
    )
    
#khjfhgfgvk