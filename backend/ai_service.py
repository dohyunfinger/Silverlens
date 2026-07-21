from google import genai


class AIServiceError(Exception):
    """Gemini API 처리 중 발생하는 오류."""


def generate_response(
    api_key: str,
    user_input: str,
) -> str:
    """사용자 입력을 Gemini에 보내고 텍스트 응답을 반환한다."""

    cleaned_input = user_input.strip()

    if not cleaned_input:
        raise ValueError("입력 내용이 비어 있습니다.")

    if not api_key:
        raise AIServiceError("Gemini API 키가 없습니다.")

    try:
        client = genai.Client(api_key=api_key)

        response = client.models.generate_content(
            model="gemini-3.5-flash",
            contents=cleaned_input,
        )

        if not response.text:
            raise AIServiceError("AI 응답 내용이 비어 있습니다.")

        return response.text.strip()

    except AIServiceError:
        raise

    except Exception as error:
        raise AIServiceError(
            f"Gemini API 호출 중 오류가 발생했습니다: {error}"
        ) from error