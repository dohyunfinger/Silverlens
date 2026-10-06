import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// "감귤녹두전"을 실제로 즐겨 먹는 별미라고 지어내고, 출처를 묻자 둘러댔던 문제를 막는 지시가 남아 있는지 확인한다.
test("chat prompt does not invent dishes or sources", async () => {
  const service = await readFile(new URL("../backend/services/geminiService.ts", import.meta.url), "utf8");

  assert.match(service, /내부 자료에 있는 요리 이름\(이 목록에 없으면 널리 알려진 요리인지 확실하지 않음\)/);
  assert.match(service, /const knownDishNames = \[/);
  assert.match(service, /'널리 알려진 요리는 아니에요'라고 먼저 밝히고/);
  assert.match(service, /summary와 answer는 이 사실을 똑같이 말해야 합니다/);
  assert.match(service, /근거 없이 '소화에 부담된다', '어울리지 않는다', '권하지 않는다'고 깎아내리지도 마세요/);
  assert.match(service, /있지도 않은 유래, 통계, 연구 결과, 기관·문헌 이름을 지어내지 마세요/);
  assert.match(service, /앞 답을 고집하지 말고 다시 판단해, 틀렸으면 틀렸다고 바로 정정하세요/);
  assert.match(service, /사용자가 출처나 근거를 물으면 솔직하게 답하세요/);
  assert.match(service, /'AI가 일반 지식으로 쓴 답이라 틀릴 수 있다'고 밝히고/);
  assert.match(service, /출처·링크·영상 주소를 지어내지 마세요/);
  // 영상은 모델이 링크를 만들지 않고, 화면이 유튜브 검색 결과로 이어 준다.
  assert.match(service, /video_search_query/);
  assert.match(service, /function cleanVideoSearchQuery/);
  assert.match(service, /parsed\.riskLevel === "danger" \|\|/);
});
