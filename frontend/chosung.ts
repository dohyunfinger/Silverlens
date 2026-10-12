/**
 * 초성 검색.
 *
 * 어르신은 휴대폰 자판에서 받침까지 다 치기 어려워한다. "ㄷㄴ"만 쳐도 "당뇨"가 나오게 하고,
 * "당ㄴ"처럼 글자와 초성이 섞여도 찾게 한다.
 */
const CHOSUNG = [
  "ㄱ", "ㄲ", "ㄴ", "ㄷ", "ㄸ", "ㄹ", "ㅁ", "ㅂ", "ㅃ", "ㅅ",
  "ㅆ", "ㅇ", "ㅈ", "ㅉ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ",
];
const HANGUL_START = 0xac00;
const HANGUL_END = 0xd7a3;
const SYLLABLES_PER_CHOSUNG = 21 * 28;

function chosungOf(char: string) {
  const code = char.charCodeAt(0);
  if (code < HANGUL_START || code > HANGUL_END) return null;
  return CHOSUNG[Math.floor((code - HANGUL_START) / SYLLABLES_PER_CHOSUNG)];
}

function isChosung(char: string) {
  return CHOSUNG.includes(char);
}

function compact(value: string) {
  return value.normalize("NFC").toLocaleLowerCase().replace(/\s+/g, "");
}

/** 검색어가 target 안에 있는지 본다. 검색어의 초성 글자는 target 글자의 초성과 맞춰 본다. */
export function matchesSearch(target: string, query: string) {
  const text = [...compact(target)];
  const wanted = [...compact(query)];
  if (wanted.length === 0) return true;
  if (!wanted.some(isChosung)) return text.join("").includes(wanted.join(""));
  for (let start = 0; start + wanted.length <= text.length; start += 1) {
    const matched = wanted.every((char, offset) => {
      const actual = text[start + offset];
      return isChosung(char) ? chosungOf(actual) === char || actual === char : actual === char;
    });
    if (matched) return true;
  }
  return false;
}
