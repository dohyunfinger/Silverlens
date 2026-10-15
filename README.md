# SilverLens

**사투리와 생활 언어, 사진, 개인 건강정보를 함께 이해해 시니어에게 쉬운 건강 식생활 정보를 제공하는 AI 서비스**

서비스 주소: <https://silverlens.ogq.workers.dev/>

SilverLens는 “어르신이 기술을 배우는 것”이 아니라 “기술이 어르신의 사용 방식에 맞추는 것”을 목표로 합니다. 큰 글씨·큰 버튼·음성·사진으로 바로 질문하고, 등록한 건강정보에 맞춘 답을 큰 글씨와 음성으로 확인합니다. 건강정보와 대화는 서버가 아닌 브라우저에 저장합니다.

> 이 서비스는 의료 진단이나 처방을 하지 않습니다. 건강·복약 판단은 의사 또는 약사와 확인해야 합니다.

## 주요 기능

### 질문하기

- 사투리·생활 언어를 포함한 음성 질문, 글 질문, 최대 4장의 사진 질문
- 음성 인식 단계에서 사투리 사전(257종)을 적용해 표준어로 이해
- 성분표·음식·약 봉투·알약 등 촬영 목적별 안내와 전송 전 밝기·흔들림 확인
- 녹음 중·전송 중 상태 표시와 “아직 보내지 않았어요” 안내로 전송 단계를 놓치지 않게 함
- 한국어·영어·일본어 화면과 언어별 음성 안내

### 내 건강정보 반영

- 알레르기 93개, 질병·건강 상태 99개를 버튼이나 말로 등록하고 음성 상세 메모 추가
- 초성 검색 지원 (“ㄷㄴ”만 입력해도 “당뇨”)
- 대화에서 직접 말한 건강정보만 내 정보에 추가
- 등록한 정보를 모든 답변에 자동 반영

### 답변 확인

- 긴 답변을 큰 글씨 카드로 나누고, 속도를 조절해 다시 듣기
- 답변과 관련된 유튜브 영상 검색 링크 제공
- 음식·약·건강 주제별 대화방으로 대화 기록 정리

### 의약품 사진 안전 확인

- 제품명, 앞·뒷면 각인, 제형, 모양, 색, 분할선을 순서대로 관찰
- 식품의약품안전처 의약품 낱알식별 OpenAPI의 공식 품목 후보와 대조
- 제품명이나 각인이 맞지 않으면 색·모양만으로 특정 약 이름을 만들지 않음
- 식약처 후보가 없으면 단정하지 않고 포장·처방전·약사 확인을 안내
- 약학정보원 자료는 복제하지 않고, 사용자가 직접 확인할 외부 검색 링크로만 제공

### 내 데이터 관리

- 내 정보·대화·상세 메모를 파일로 내보내기, 불러오기, 삭제

## 음성 안내

답변과 안내를 읽는 음성은 아래 순서로 정합니다. 앞 단계가 실패하면 자동으로 다음 단계로 넘어가므로 음성이 끊기지 않습니다.

| 순서 | 경로 | 쓰이는 곳 |
| --- | --- | --- |
| 1 | 미리 만든 안내 음성 (`public/narration/`) | 고정된 안내 문구. 생성 대기와 크레딧 없이 바로 재생 |
| 2 | ElevenLabs TTS | 답변 음성 (속도를 바꿨을 때) |
| 3 | Gemini TTS | ElevenLabs 키가 없거나 실패했을 때 |
| 4 | 브라우저 내장 음성 | 기본 속도의 답변, 서버 음성을 쓸 수 없을 때 |

- **목소리:** 한국어는 ElevenLabs Voice Library의 “Anna Kim”을 기본으로 시도합니다. 이 목소리는 유료 요금제에서만 API로 쓸 수 있어, 무료 요금제에서는 기본 목소리 “Sarah”로 자동 전환합니다.
- **설정:** 모델 `eleven_multilingual_v2`, 속도 0.9배, 일정한 톤(stability 0.65), 과장 없는 읽기(style 0)
- **캐시:** 만든 음성은 서버(30분)와 브라우저에 보관해 같은 문장을 다시 들을 때 즉시 재생합니다.

### 안내 음성 다시 만들기

고정 안내 문구는 [`frontend/guideNarration.ts`](frontend/guideNarration.ts)에 모여 있습니다. 문구를 고치거나 요금제를 바꾼 뒤에는 아래 명령으로 음성 파일을 다시 만듭니다.

```bash
npm run narration:guide
```

- 문구·목소리·설정이 같은 파일은 다시 만들지 않으므로 크레딧을 아낍니다.
- 쓰지 않게 된 예전 파일은 자동으로 지웁니다.
- 지금은 한국어만 만듭니다. 영어·일본어는 `ELEVENLABS_VOICE_ID_EN`, `ELEVENLABS_VOICE_ID_JA`를 지정하면 함께 만듭니다.

## 개인정보와 저장 위치

| 데이터 | 저장·전송 방식 |
| --- | --- |
| 프로필·건강정보·메모·대화 | 브라우저 IndexedDB에만 저장. 서버에는 저장하지 않음 |
| 질문 | 질문할 때 답변 생성에 필요한 내용만 Gemini API로 전송 |
| 사진 | 보내기 전에는 브라우저에 임시 보관 후 만료 시 삭제. 질문할 때 Gemini API로 전송 |
| 음성 출력 | 답변을 음성으로 들을 때 답변 문장을 TTS 서비스(ElevenLabs 또는 Gemini)로 전송 |
| 백업·복원 | 데이터 화면에서 JSON 파일로 내보내거나 다시 불러오기 |

브라우저 저장소를 지우거나 기기를 바꾸면 로컬 정보가 사라질 수 있으므로, 데이터 화면의 내보내기로 백업할 수 있습니다.

## 안전 설계

| 항목 | 구현 방식 |
| --- | --- |
| 알레르기 | 등록 알레르기가 질문·재료에 나타나면 모델 판정과 관계없이 위험 경고 |
| 위험도 하한선 | 등록 질병과 위험 식품이 함께 걸리면 코드가 최소 위험도를 보장 |
| 과도한 제한 방지 | 밀 알레르기 때문에 소금까지 금지하는 식의 무관한 제한을 하지 않도록 구체 규칙 적용 |
| 의약품 식별 | 제품명 또는 각인이 맞는 후보만 남기며 색·모양만으로 특정하지 않음 |
| 의료 경계 | 진단·처방·임의 복약 지시를 하지 않고, 위험하거나 불확실하면 전문가 확인 안내 |
| 회귀 테스트 | 알레르기 안내, 답변 정직성, 약 식별, 건강정보 분류 등을 `tests/`에서 검증 |
| 서버 로그 | `/log`·`/api/log`는 개발 환경에서만 열리고, 운영에서는 명시적으로 켜야 함 |

## 데이터 현황

아래 숫자는 현재 저장소의 JSON을 기준으로 계산한 값입니다.

| 데이터 | 현재 규모 | 용도 |
| --- | ---: | --- |
| 한식 대표 메뉴명 | 1,236종 | 14,567개 부재료 조합을 대표 이름으로 정규화 |
| 요리 사전 | 637종 | 대표 요리명, 지역별 명칭, 재료 구성 |
| 시니어 식품 지식 | 580종 | 권장량, 조리 안내, 질병 주의, 음식 궁합 검색 |
| 외국 음식 사전 | 501종 | 낯선 외래 음식명을 쉬운 표현으로 설명 |
| 식품 외래어·별칭 | 500종 | 별칭 269개, 외래어 231개를 표준 표현에 연결 |
| 질병명 다국어 대응 | 460개 | 한국어·영어·일본어·일본어 로마자 표기 |
| 시니어 다빈도 상병명 | 405개 | 직접 입력한 병명을 읽기 쉬운 표기로 정규화 |
| 사투리 사전 | 257종 | 식재료·음식·신체증상·생활 분야의 지역 표현 |
| 건강정보 항목 | 192개 | 알레르기 93개, 질병·건강 상태 99개를 3개 언어 ID로 관리 |
| 건강정보 화면 그룹 | 66개 | 알레르기 23, 질병 40, 식이 상태 3개 그룹 |
| 안전 규칙 | 21개 | 위험 식품 123종, 위험도 하한선 규칙 11개 |
| 약 사진 관찰 기준 | 10개 | 식별 전 확인할 관찰 항목과 안전 결정 규칙 |
| 식약처 낱알 품목 | 동기화 시 결정 | `MFDS_DATA_API_KEY`로 동기화한 공식 레코드 |

### 데이터 출처와 이용 범위

| 구분 | 출처 | 실제 활용과 범위 |
| --- | --- | --- |
| 공공 언어 사전 참고 | [국립국어원 우리말샘](https://opendict.korean.go.kr) | 사투리·지역어·생활 언어 표기와 의미 확인. 서비스용 사투리 목록은 팀이 선별·검증해 별도 관리 |
| 공식 의약품 데이터 | [식품의약품안전처 의약품 낱알식별 정보](https://www.data.go.kr/data/15057639/openapi.do) | 제품명·각인·제형·모양·색·분할선·공식 이미지 URL 동기화. 공공데이터포털 이용허락범위 제한 없음 |
| 외부 최종 확인 | [약학정보원 의약품 식별검색](https://health.kr/searchIdentity/search.asp) | 사이트 자료를 복제·수집·재배포하지 않고 사용자가 직접 확인하는 링크로만 제공 |
| 팀 정리 자료 | [`data/sources`](./data/sources), [`data`](./data) | 식품·요리·별칭·건강 항목·안전 규칙을 서비스 목적에 맞게 정리. 공식 진단·처방 기준이 아닌 참고 데이터 |

### 원본과 생성물

`npm run prepare:data`는 아래 원본을 검증해 앱이 읽는 JSON을 다시 만듭니다. 한 글자 사투리, 자기 자신으로 매핑되는 항목, 중복, 허용 범위를 벗어난 지역·분류 등을 검사합니다.

- `data/sources/dialect_dictionary.csv`
- `data/sources/disease_i18n.csv`
- `data/sources/korean_dish_names.txt`
- `data/sources/recipes.json`
- `data/sources/senior_food_knowledge.py`
- `data/sources/senior_frequent_conditions.txt`

`food_aliases.json`과 일부 서비스용 지식은 변환 대상 밖에서 별도로 관리합니다.

## 기술 구성

| 영역 | 구성 |
| --- | --- |
| 웹 | Next.js 16, React 19, TypeScript, Vinext/Vite |
| 실행·호스팅 | Cloudflare Workers |
| 의약품 카탈로그 | Cloudflare D1 (예약 작업으로 식약처 데이터 갱신) |
| AI | Gemini 텍스트·이미지·오디오 입력, 모델 폴백과 429 재시도 |
| 음성 출력 | ElevenLabs TTS → Gemini TTS → 브라우저 음성 |
| 로컬 저장 | IndexedDB |
| 선택형 방언 변환 | `backend/local_dialect` FastAPI 서버 |

## 시작하기

Node.js 22.13 이상이 필요합니다. 안내 음성 생성 스크립트(`npm run narration:guide`)는 TypeScript 파일을 바로 읽으므로 Node.js 22.18 이상에서 실행하세요.

```bash
npm install
cp .env.example .env.local   # 키를 채워 넣습니다
npm run dev
```

| 명령 | 하는 일 |
| --- | --- |
| `npm run dev` | 개발 서버 실행 |
| `npm test` | 빌드 후 회귀 테스트 실행 |
| `npm run lint` | ESLint 검사 |
| `npm run deploy` | 빌드 후 Cloudflare Workers에 배포 |
| `npm run narration:guide` | 안내 문구 음성 파일 생성 ([음성 안내](#안내-음성-다시-만들기) 참고) |
| `npm run sync:drug-data` | 식약처 낱알식별 데이터를 JSON으로 동기화 |
| `npm run prepare:data` | `data/sources` 원본을 검증해 JSON 재생성 (Python 3) |

### 환경변수

| 변수 | 용도 |
| --- | --- |
| `GEMINI_API_KEY` | 시니어 대화, 음성 인식, 사진 분석, 예비 TTS (필수) |
| `GEMINI_TEXT_MODEL`, `GEMINI_TTS_MODEL` | 기본 모델 변경 (선택) |
| `ELEVENLABS_API_KEY` | ElevenLabs 음성 출력과 안내 음성 생성 (선택, 없으면 Gemini TTS) |
| `ELEVENLABS_VOICE_ID_KO` | 한국어 목소리 (기본 Anna Kim, 유료 요금제 필요) |
| `ELEVENLABS_FREE_VOICE_ID_KO` | 무료 요금제일 때 쓸 한국어 목소리 (기본 Sarah) |
| `ELEVENLABS_VOICE_ID_EN`, `ELEVENLABS_VOICE_ID_JA` | 영어·일본어 목소리 (지정하지 않으면 Gemini TTS) |
| `ELEVENLABS_MODEL` | ElevenLabs 모델 (기본 `eleven_multilingual_v2`) |
| `NEXT_PUBLIC_DIALECT_API_URL` | 선택형 로컬 방언 변환 서버 주소 |
| `MFDS_DATA_API_KEY` | 식약처 낱알 데이터 동기화용. 배포에서는 Cloudflare Secret으로 저장 |

배포 환경의 키는 `npx wrangler secret put <변수명>`으로 Cloudflare Secret에 저장합니다.

## 프로젝트 구조

```text
.
├── .openai/                               # 배포 설정과 D1 마이그레이션
├── app/
│   ├── api/
│   │   ├── chat/                          # 시니어 AI 답변
│   │   ├── transcribe/                    # 음성 인식·건강정보 분류
│   │   ├── tts/                           # 답변 음성 생성
│   │   ├── drugs/status/                  # 식약처 카탈로그 준비 상태
│   │   └── log/                           # 개발용 지식 데이터 상태 API
│   ├── log/page.tsx                       # 개발 전용 데이터 점검 화면
│   ├── globals.css                        # 시니어·소개 반응형 스타일
│   ├── layout.tsx                         # 메타데이터와 공통 레이아웃
│   └── page.tsx                           # 시니어 서비스 진입
├── frontend/
│   ├── SilverLensApp.tsx                  # 시니어 설정·대화·데이터·서비스 소개
│   ├── guideNarration.ts                  # 미리 만든 음성으로 읽는 안내 문구
│   ├── conversations.ts                   # 주제별 대화방 저장·복원
│   ├── entryScreen.ts                     # 첫 방문 소개 → 내 정보 → 대화 화면 결정
│   ├── chosung.ts                         # 건강정보 초성 검색
│   ├── localStore.ts                      # IndexedDB 저장·백업·복구
│   ├── photoCapture.ts                    # 사진 축소와 밝기·흔들림 검사
│   └── DataLogView.tsx                    # 개발용 데이터 통계 화면
├── backend/
│   ├── config/env.ts                      # 환경변수, Gemini 모델 체인, ElevenLabs 설정
│   ├── data/
│   │   ├── loadData.ts                    # 질문 관련 식품·규칙·의약품 후보 검색
│   │   ├── healthTerms.ts                 # 건강정보 ID와 다국어 표시명
│   │   └── diseaseI18n.ts                 # 질병명 다국어 정규화
│   ├── services/
│   │   ├── geminiClient.ts                # Gemini 호출·폴백·429 재시도
│   │   ├── geminiQuota.ts                 # Gemini 무료 한도 초과 처리
│   │   ├── geminiService.ts               # 시니어 답변과 안전 하한선
│   │   ├── transcriptionService.ts        # 음성 인식과 건강정보 추출
│   │   ├── koreanAge.ts                   # 말로 한 나이를 숫자로 변환
│   │   ├── ttsService.ts                  # ElevenLabs·Gemini 음성 생성과 캐시
│   │   └── mfdsPillData.ts                # 식약처 의약품 카탈로그 조회·동기화
│   └── local_dialect/                     # 선택형 FastAPI 방언 변환 서버
├── data/
│   ├── sources/                           # 사람이 편집하는 변환 원본 6종
│   └── *.json                             # 앱이 읽는 식품·건강·안전·의약품 데이터
├── public/
│   ├── narration/                         # 미리 만든 안내 음성과 목록(manifest.json)
│   ├── about/                             # 서비스 소개 이미지
│   ├── guide/                             # 사용법 이미지
│   ├── source-icons/                      # 데이터 출처 기관 로고
│   ├── brand/, favicon.svg, og.png
├── scripts/
│   ├── generate-guide-narration.mjs       # 안내 음성 생성
│   ├── sync-mfds-pill-data.mjs            # 식약처 데이터 동기화
│   ├── prepare_knowledge_data.py          # 데이터 원본 검증·변환
│   ├── build-verified.mjs                 # 빌드와 산출물 검증
│   └── validate-artifact.mjs
├── build/
│   ├── sites-vite-plugin.ts               # 배포 산출물·마이그레이션 패키징
│   └── mobile-only-media.mjs              # PC에서도 휴대폰 화면으로 통일
├── db/schema.ts                           # D1 테이블 정의
├── worker/index.ts                        # Worker 진입점, D1 예약 동기화
├── tests/                                 # 안전·렌더링·데이터 회귀 테스트
├── docs/                                  # 브랜드·참고 이미지
├── vite.config.ts                         # Vinext·Cloudflare 빌드 설정
├── .env.example                           # 키 이름만 있는 환경변수 예시
└── LICENSE
```

## 팀

구미전자공업고등학교 전자시스템제어과 · **우승에 동의**

| 이름 | 역할 |
| --- | --- |
| 박정찬 | 팀장, 프로젝트 아이디어, AI 프롬프트 설계, 데이터 수집 |
| 최수혁 | 백엔드·프론트엔드, AI 기능 구현 및 기능 기획 |
| 김근호 | 프론트엔드, UI/UX |
| 이도현 | 저장소·배포 관리, 데이터 수집 |

## 라이선스

이 저장소의 코드는 [MIT License](LICENSE)를 따릅니다. 외부 데이터와 연결 사이트의 자료에는 각 제공기관의 별도 이용 조건이 적용됩니다.
