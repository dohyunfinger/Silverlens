def generate_response(user_input: str) -> str:
    cleaned_input = user_input.strip()

    if not cleaned_input:
        raise ValueError("내용을 입력해주세요.")

    return f"입력한 내용: {cleaned_input}"