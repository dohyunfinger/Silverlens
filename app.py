import streamlit as st

from frontend.main_page import render_main_page


def main() -> None:
    st.set_page_config(
        page_title="SilverLens",
        page_icon="🤖",
        layout="wide",
    )

    render_main_page()


if __name__ == "__main__":
    main()