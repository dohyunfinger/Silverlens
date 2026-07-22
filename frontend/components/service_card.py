import streamlit as st


def show_service_card(icon, title, description="", key=None):
    """
    서비스 카드 컴포넌트

    Parameters
    ----------
    icon : str
        이모지 또는 아이콘

    title : str
        서비스 이름

    description : str
        서비스 설명

    key : str
        버튼 key
    """

    with st.container(border=True):

        st.markdown(
            f"""
            <div style="
                text-align:center;
                padding:20px;
            ">

                <div style="
                    font-size:42px;
                    margin-bottom:10px;
                ">
                    {icon}
                </div>

                <div style="
                    font-size:24px;
                    font-weight:bold;
                    color:#222222;
                ">
                    {title}
                </div>

                <div style="
                    font-size:18px;
                    color:#666666;
                    margin-top:8px;
                ">
                    {description}
                </div>

            </div>
            """,
            unsafe_allow_html=True
        )

        return st.button(
            f"{title} 선택",
            key=key,
            use_container_width=True
        )