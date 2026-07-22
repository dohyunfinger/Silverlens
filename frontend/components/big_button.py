import streamlit as st


def show_big_button(label, key=None):
    """
    큰 버튼 컴포넌트

    Parameters
    ----------
    label : str
        버튼에 표시할 글자

    key : str
        Streamlit 버튼 고유 key
    """

    st.markdown("""
        <style>
        div.stButton > button{
            width:100%;
            height:75px;

            font-size:24px;
            font-weight:bold;

            border-radius:18px;

            background-color:#2B7FFF;
            color:white;

            border:none;

            transition:0.2s;
        }

        div.stButton > button:hover{
            background-color:#1F64CC;
            cursor:pointer;
        }
        </style>
    """, unsafe_allow_html=True)

    return st.button(label, key=key, use_container_width=True)