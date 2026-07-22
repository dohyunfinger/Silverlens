import streamlit as st


def show_header(title, subtitle=None):
    """
    공통 Header

    Parameters
    ----------
    title : str
        메인 제목

    subtitle : str
        부제목 (선택)
    """

    st.markdown(
        f"""
        <div style="
            text-align:center;
            padding-top:20px;
            padding-bottom:20px;
        ">

            <div style="
                font-size:40px;
                margin-bottom:10px;
            ">
                😊
            </div>

            <div style="
                font-size:34px;
                font-weight:bold;
                color:#222222;
            ">
                {title}
            </div>

            <div style="
                font-size:22px;
                color:#666666;
                margin-top:10px;
            ">
                {subtitle if subtitle else ""}
            </div>

        </div>
        """,
        unsafe_allow_html=True
    )

    st.markdown("---")