import streamlit as st


def show_footer():
    """
    모든 페이지에서 사용하는 Footer
    """

    st.markdown("---")

    st.markdown(
        """
        <div style="
            text-align:center;
            color:#666666;
            font-size:18px;
            padding:10px;
        ">
            AI 생활 도우미<br>
            항상 쉽고 편리하게 도와드리겠습니다.
        </div>
        """,
        unsafe_allow_html=True
    )