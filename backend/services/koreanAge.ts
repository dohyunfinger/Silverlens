/**
 * 말로 한 나이를 숫자로 옮기는 모듈.
 *
 * 음성 인식 모델이 "일흔"을 60으로 옮기는 일이 실제로 있었다. 나이는 화면의
 * 선택 버튼을 바꾸고 하루 권장 섭취량 안내에도 쓰이는 값이라, 모델 판단에만
 * 맡기지 않고 받아쓴 문장을 코드로 다시 읽는다.
 *
 * 다른 모듈을 부르지 않는 순수 함수만 두어 브라우저나 Node 어디서든 그대로
 * 검증할 수 있게 했다.
 */

/** 나이를 뜻하는 우리말·한자말과 숫자 대응. */
const AGE_WORD_VALUES: Record<string, number> = {
  스무: 20,
  스물: 20,
  서른: 30,
  마흔: 40,
  쉰: 50,
  예순: 60,
  일흔: 70,
  여든: 80,
  아흔: 90,
  이십: 20,
  삼십: 30,
  사십: 40,
  오십: 50,
  육십: 60,
  륙십: 60,
  칠십: 70,
  팔십: 80,
  구십: 90,
};

/** 우리말 낱개 수사. "예순다섯" 처럼 뒤에 붙는 값을 더하려고 쓴다. */
const AGE_UNIT_VALUES: Record<string, number> = {
  한: 1,
  하나: 1,
  두: 2,
  둘: 2,
  세: 3,
  셋: 3,
  네: 4,
  넷: 4,
  다섯: 5,
  여섯: 6,
  일곱: 7,
  여덟: 8,
  아홉: 9,
};

const sortedByLength = (words: string[]) =>
  [...words].sort((a, b) => b.length - a.length);

// 긴 낱말을 먼저 찾아야 "스물"이 "스무"로 잘리지 않는다.
const AGE_WORD_PATTERN = new RegExp(
  `(${sortedByLength(Object.keys(AGE_WORD_VALUES)).join("|")})`,
  "g",
);
const AGE_UNIT_PATTERN = new RegExp(
  `^\\s*(${sortedByLength(Object.keys(AGE_UNIT_VALUES)).join("|")})`,
);

/**
 * 나이 낱말 뒤에 붙어 "이게 나이다"를 알려 주는 표현.
 * "쉰 김치"처럼 나이와 무관한 말에서 숫자를 뽑지 않기 위한 장치다.
 */
const AGE_CONTEXT_AFTER =
  /^\s*(?:살|세|대|이고|이며|이야|이에요|예요|입니다|이라|됩니다|됐|넘었|가까|정도|쯤)/;
/** 나이 낱말 앞에 나오는 표현. */
const AGE_CONTEXT_BEFORE = /(나이|연세|연령|올해)[^.?!]{0,12}$/;

/**
 * 받아쓴 문장에서 나이를 뽑는다. 찾지 못하면 null.
 *
 * 숫자 + 단위("70대", "73살")가 가장 분명해서 먼저 보고, 없으면 우리말 수사를
 * 본다. 우리말 수사는 앞뒤에 나이 문맥이 있을 때만 인정한다.
 */
export function extractAgeFromTranscript(transcript: string): number | null {
  if (typeof transcript !== "string" || !transcript.trim()) return null;

  const digitMatch = transcript.match(/(\d{1,3})\s*(?:대|살|세)/);
  if (digitMatch) {
    const parsed = Number(digitMatch[1]);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }

  for (const match of transcript.matchAll(AGE_WORD_PATTERN)) {
    const word = match[1];
    const index = match.index ?? 0;
    const after = transcript.slice(index + word.length);
    const before = transcript.slice(0, index);

    // "예순다섯" 처럼 낱개 수사가 붙으면 더해 준다.
    const unitMatch = after.match(AGE_UNIT_PATTERN);
    const unit = unitMatch ? AGE_UNIT_VALUES[unitMatch[1]] : 0;
    const rest = unitMatch ? after.slice(unitMatch[0].length) : after;

    const looksLikeAge =
      AGE_CONTEXT_AFTER.test(rest) ||
      (unitMatch ? AGE_CONTEXT_AFTER.test(after) : false) ||
      AGE_CONTEXT_BEFORE.test(before);
    if (looksLikeAge) return AGE_WORD_VALUES[word] + unit;
  }
  return null;
}
