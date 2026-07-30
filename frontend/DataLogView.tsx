"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

/**
 * 임시 데이터 점검 화면입니다.
 * data 폴더에서 변환한 자료가 백엔드 검색·번역 경로에 실제로 붙었는지
 * /api/log 응답을 그대로 보여 줍니다. 서비스 화면과는 분리되어 있고
 * 배포 환경에서는 /api/log 가 기본으로 닫혀 있습니다.
 */

type LogPayload = {
  checkedAt: string;
  environment: Record<string, string>;
  modelCooldowns: Array<{ model: string; secondsLeft: number }>;
  narrationCache: { entries: number; bytes: number };
  datasets: Record<string, number>;
  dialectByCategory: Record<string, number>;
  safetyRuleIds: string[];
  healthGroups: {
    allergy: Array<{ title: string; count: number }>;
    condition: Array<{ title: string; count: number }>;
    coverage: { allergy: string; condition: string };
  };
  search: {
    question: string;
    language: string;
    conditionLabels: string[];
    riskFloorHits: Array<{
      ruleId: string;
      floor: string;
      matchedFoods: string[];
    }>;
    dialectHints: Array<{
      dialect: string;
      standard: string;
      region: string;
      category: string;
    }>;
    foodAliasHints: Array<{ alias: string; standard: string; kind: string }>;
    dishNameHints: Array<{ name: string; variantCount: number }>;
    recipes: string[];
    foods: Array<{ name: string; cautionDiseases: string[] }>;
    safetyRules: string[];
  };
  translationChecks: Array<{ input: string; en: string; ja: string }>;
  resolveChecks: Array<{ input: string; id: string | null }>;
  frequentConditionChecks: Array<{ input: string; matched: string | null }>;
  error?: string;
};

const DEFAULT_QUESTION =
  "정구지랑 무시 넣고 제육볶음 하려는데 브로컬리도 괜찮아요? 무루팍이 시원찮아서요";

export default function DataLogView() {
  const [question, setQuestion] = useState(DEFAULT_QUESTION);
  const [language, setLanguage] = useState("ko-KR");
  const [conditions, setConditions] = useState("당뇨, 만성 신장질환");
  const [data, setData] = useState<LogPayload | null>(null);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ q: question, language, conditions });
      const response = await fetch(`/api/log?${params.toString()}`);
      const payload = (await response.json()) as LogPayload;
      if (!response.ok) {
        throw new Error(payload.error || "점검 정보를 불러오지 못했습니다.");
      }
      setData(payload);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "점검 정보를 불러오지 못했습니다.");
    } finally {
      setIsLoading(false);
    }
  }, [conditions, language, question]);

  // 첫 진입 때 한 번만 자동으로 불러오고, 이후에는 버튼으로 갱신합니다.
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="log-root">
      <header className="log-head">
        <h1>데이터 연결 점검 (임시)</h1>
        <p>
          <code>data/</code> 폴더에서 변환한 자료가 백엔드 검색·번역 경로에 붙었는지
          확인하는 개발용 화면입니다. Gemini 호출 없이 서버 안에서만 계산합니다.
        </p>
        <Link className="log-back" href="/">
          ← 서비스 화면으로
        </Link>
      </header>

      <section className="log-form">
        <label>
          <span>시험 질문</span>
          <input
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="사투리나 음식 이름을 넣어 보세요"
          />
        </label>
        <label>
          <span>화면 언어</span>
          <select value={language} onChange={(event) => setLanguage(event.target.value)}>
            <option value="ko-KR">ko-KR</option>
            <option value="en-US">en-US</option>
            <option value="ja-JP">ja-JP</option>
          </select>
        </label>
        <label>
          <span>등록 질병 (쉼표 구분)</span>
          <input
            value={conditions}
            onChange={(event) => setConditions(event.target.value)}
            placeholder="당뇨, 만성 신장질환"
          />
        </label>
        <button type="button" onClick={() => void load()} disabled={isLoading}>
          {isLoading ? "조회 중…" : "다시 조회"}
        </button>
      </section>

      {error && (
        <p className="log-error" role="alert">
          {error}
        </p>
      )}

      {data && (
        <div className="log-grid">
          <section className="log-card">
            <h2>데이터 건수</h2>
            <table>
              <tbody>
                {Object.entries(data.datasets).map(([key, value]) => (
                  <tr key={key}>
                    <th>{key}</th>
                    <td>{value.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="log-card">
            <h2>환경 설정</h2>
            <table>
              <tbody>
                {Object.entries(data.environment).map(([key, value]) => (
                  <tr key={key}>
                    <th>{key}</th>
                    <td>{value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="log-note">API 키는 값이 아니라 설정 여부만 표시합니다.</p>
            <h3>답변 음성 캐시</h3>
            <p className="log-note">
              {data.narrationCache.entries}개 보관 ·{" "}
              {(data.narrationCache.bytes / (1024 * 1024)).toFixed(1)}MB
            </p>
            <h3>한도에 걸려 잠시 쉬는 모델</h3>
            {data.modelCooldowns.length === 0 ? (
              <p className="log-note">없음. 기본 모델을 그대로 쓰고 있습니다.</p>
            ) : (
              <ul>
                {data.modelCooldowns.map((item) => (
                  <li key={item.model}>
                    {item.model} <em>{item.secondsLeft}초 뒤 재시도</em>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="log-card">
            <h2>사투리 사전 분류</h2>
            <table>
              <tbody>
                {Object.entries(data.dialectByCategory).map(([key, value]) => (
                  <tr key={key}>
                    <th>{key}</th>
                    <td>{value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="log-card">
            <h2>건강정보 묶음</h2>
            <p className="log-note">
              알레르기 {data.healthGroups.coverage.allergy} · 질병{" "}
              {data.healthGroups.coverage.condition} 항목이 묶음에 들어갔습니다.
            </p>
            <h3>알레르기</h3>
            <ul>
              {data.healthGroups.allergy.map((group) => (
                <li key={group.title}>
                  {group.title} <strong>{group.count}</strong>
                </li>
              ))}
            </ul>
            <h3>질병</h3>
            <ul>
              {data.healthGroups.condition.map((group) => (
                <li key={group.title}>
                  {group.title} <strong>{group.count}</strong>
                </li>
              ))}
            </ul>
          </section>

          <section className="log-card log-card-wide">
            <h2>질문 검색 결과</h2>
            <p className="log-note">
              질문: {data.search.question} · 언어 {data.search.language}
            </p>
            <h3>방언 인식 {data.search.dialectHints.length}건</h3>
            <ul>
              {data.search.dialectHints.map((hint) => (
                <li key={hint.dialect}>
                  {hint.dialect} → {hint.standard}{" "}
                  <em>
                    {hint.region} / {hint.category}
                  </em>
                </li>
              ))}
              {data.search.dialectHints.length === 0 && <li>없음</li>}
            </ul>
            <h3>외래어·별칭 {data.search.foodAliasHints.length}건</h3>
            <ul>
              {data.search.foodAliasHints.map((hint) => (
                <li key={hint.alias}>
                  {hint.alias} → {hint.standard} <em>{hint.kind}</em>
                </li>
              ))}
              {data.search.foodAliasHints.length === 0 && <li>없음</li>}
            </ul>
            <h3>한식 메뉴명 {data.search.dishNameHints.length}건</h3>
            <ul>
              {data.search.dishNameHints.map((hint) => (
                <li key={hint.name}>
                  {hint.name} <em>부재료 조합 {hint.variantCount}</em>
                </li>
              ))}
              {data.search.dishNameHints.length === 0 && <li>없음</li>}
            </ul>
            <h3>요리 사전 {data.search.recipes.length}건</h3>
            <ul>
              {data.search.recipes.map((name) => (
                <li key={name}>{name}</li>
              ))}
              {data.search.recipes.length === 0 && <li>없음</li>}
            </ul>
            <h3>시니어 식품 {data.search.foods.length}건 (주의 질병은 선택 언어로 변환)</h3>
            <ul>
              {data.search.foods.map((food) => (
                <li key={food.name}>
                  {food.name} <em>{food.cautionDiseases.join(", ") || "주의 질병 없음"}</em>
                </li>
              ))}
              {data.search.foods.length === 0 && <li>없음</li>}
            </ul>
            <h3>적용된 안전 원칙 {data.search.safetyRules.length}건</h3>
            <ul>
              {data.search.safetyRules.map((id) => (
                <li key={id}>{id}</li>
              ))}
            </ul>
            <h3>위험도 하한선 {data.search.riskFloorHits.length}건</h3>
            <ul>
              {data.search.riskFloorHits.map((hit) => (
                <li key={hit.ruleId}>
                  {hit.floor} ← {hit.ruleId} <em>{hit.matchedFoods.join(", ")}</em>
                </li>
              ))}
              {data.search.riskFloorHits.length === 0 && <li>없음</li>}
            </ul>
          </section>

          <section className="log-card">
            <h2>질병명 번역</h2>
            <table>
              <thead>
                <tr>
                  <th>입력</th>
                  <th>en</th>
                  <th>ja</th>
                </tr>
              </thead>
              <tbody>
                {data.translationChecks.map((check) => (
                  <tr key={check.input}>
                    <th>{check.input}</th>
                    <td>{check.en}</td>
                    <td>{check.ja}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="log-card">
            <h2>다국어 입력 → ID</h2>
            <table>
              <tbody>
                {data.resolveChecks.map((check) => (
                  <tr key={check.input}>
                    <th>{check.input}</th>
                    <td>{check.id ?? "매칭 없음"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <h3>다빈도 상병 정규화</h3>
            <table>
              <tbody>
                {data.frequentConditionChecks.map((check) => (
                  <tr key={check.input}>
                    <th>{check.input}</th>
                    <td>{check.matched ?? "매칭 없음"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>
      )}
    </main>
  );
}
