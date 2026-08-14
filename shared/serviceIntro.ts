/**
 * 로그인 없이도 같은 브라우저에서는 서비스 소개를 한 번만 보여 주기 위한 표식이다.
 * 건강정보나 식별자를 담지 않고, 소개를 확인했는지만 저장한다.
 */
export const SERVICE_INTRO_COOKIE_NAME = "silverlens_service_intro_seen";
export const SERVICE_INTRO_COOKIE_VALUE = "1";
export const SERVICE_INTRO_COOKIE_MAX_AGE = 60 * 60 * 24 * 365 * 10;
