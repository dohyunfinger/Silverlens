# SilverLens

**사투리와 생활 언어, 사진, 개인 건강정보를 함께 이해해 시니어와 돌봄이에게 쉬운 건강 식생활 정보를 제공하는 AI 서비스**

SilverLens는 “어르신이 기술을 배우는 것”이 아니라 “기술이 어르신의 사용 방식에 맞추는 것”을 목표로 합니다. 시니어 화면은 로그인 없이 바로 열리고, 큰 글씨·큰 버튼·음성·사진 중심으로 질문할 수 있습니다. 필요할 때만 본인이 연결 코드를 발급해 로그인한 돌봄이와 정보를 공유합니다.

> 이 서비스는 의료 진단이나 처방을 하지 않습니다. 건강·복약 판단은 의사 또는 약사와 확인해야 합니다.

## 현재 구현된 기능

### 시니어 화면

- 가입·로그인 없이 질문하고 기기에 정보 저장
- 한국어·영어·일본어 UI와 언어별 음성 안내
- 사투리·생활 언어를 포함한 음성 질문, 글 질문, 최대 4장의 사진 질문
- 성분표·음식·약 봉투·알약 촬영 목적별 안내와 전송 전 밝기·흔들림 확인
- 알레르기 46개, 질병·건강 상태 53개 및 음성 상세 메모 반영
- 코드가 보장하는 알레르기·질병 위험도 하한선
- 긴 답변을 큰 글씨 카드로 분리하고 속도 조절 가능한 다시 듣기 제공
- 내 정보·대화·상세 메모를 파일로 내보내기, 불러오기, 삭제

### 시니어–돌봄이 연결

- 시니어가 데이터 화면에서 10분 동안 한 번만 쓸 수 있는 연결 코드 발급
- 화면 언어별로 읽기 쉬운 코드 생성
  - 한국어: `하늘-나무-기차-572`
  - 영어: `apple-river-chair-572`
  - 일본어: `そら-かわ-いす-572`
- 돌봄이가 코드를 한 번 등록하면 해당 계정과 연결 유지
- 연결 전 정보와 최근 대화를 최초 공유하고, 연결 뒤 같은 기기에서 생긴 변경사항 지속 동기화
- 시니어는 로그인하지 않으며, 직접 코드를 만든 경우에만 연결 가능

### 돌봄이 화면

- Google 로그인과 이메일 회원가입·로그인
- 한 계정에서 여러 시니어 등록, 목록·이름 검색, 시니어별 건강정보와 최근 대화 확인
- 일반 AI 서비스와 비슷한 대화형 화면에서 선택한 시니어의 공유 기록을 문맥으로 질문
- 돌봄이 질문은 음식·건강 주제로 잠그지 않되 의료 진단·처방 안전선 유지
- 새 대화 생성과 돌봄이 대화 기록 삭제

### 의약품 사진 안전 확인

- 제품명, 앞·뒷면 각인, 제형, 모양, 앞·뒷면 색, 앞·뒷면 분할선을 순서대로 관찰
- 식품의약품안전처 의약품 낱알식별 OpenAPI의 공식 품목 후보와 대조
- 제품명이나 각인이 전혀 맞지 않으면 색·모양만으로 특정 약 이름을 만들지 않음
- 식약처 후보가 비어 있으면 특정 제품을 단정하지 않고 포장·처방전·약사 확인 안내
- 약학정보원 자료는 복제하지 않고 사용자가 최종 확인할 외부 검색 링크로만 제공

## 개인정보와 저장 위치

| 상태 | 저장·공유 방식 |
| --- | --- |
| 돌봄이와 연결하기 전 | 시니어 프로필, 건강정보, 메모, 대화는 브라우저 IndexedDB에 저장 |
| 연결 코드 발급 | 시니어 기기 식별자와 공유 스냅샷을 Cloudflare D1에 저장하고 일회용 코드 발급 |
| 돌봄이 등록 후 | 인증된 돌봄이 계정만 연결된 시니어의 공유 정보와 이후 동기화 내용을 조회 |
| 사진 첨부 | 보내기 전 사진은 브라우저에 임시 보관하며 만료 후 삭제; 질문 시 Gemini API로 전송 |
| 돌봄이 인증 | Firebase ID 토큰을 서버에서 검증하고 서명된 HttpOnly 세션 쿠키 사용 |

시니어에게 계정을 요구하지 않는 대신, 브라우저 저장소를 지우거나 기기를 바꾸면 로컬 정보가 사라질 수 있습니다. 데이터 화면의 저장 파일 내보내기를 백업 수단으로 사용할 수 있습니다.

## 데이터 현황

아래 숫자는 현재 저장소의 JSON을 기준으로 계산한 값입니다.

| 데이터 | 현재 규모 | 용도 |
| --- | ---: | --- |
| 시니어 식품 지식 | 580종 | 권장량, 조리 안내, 질병 주의, 음식 궁합 검색 |
| 요리 사전 | 637종 | 대표 요리명, 지역별 명칭, 재료 구성 |
| 외국 음식 사전 | 501종 | 낯선 외래 음식명을 쉬운 표현으로 설명 |
| 한식 대표 메뉴명 | 1,236종 | 14,567개 부재료 조합을 대표 이름으로 정규화 |
| 식품 외래어·별칭 | 500종 | 별칭 269개, 외래어 231개를 표준 표현에 연결 |
| 사투리 사전 | 257종 | 식재료·음식·신체증상·생활 분야의 지역 표현 |
| 안전 규칙 | 21개 | 위험 식품 123종, 위험도 하한선 규칙 11개 |
| 건강정보 항목 | 99개 | 알레르기 46개, 질병·건강 상태 53개를 3개 언어 ID로 관리 |
| 건강정보 화면 그룹 | 66개 | 알레르기 23, 질병 40, 식이 상태 3개 그룹 |
| 질병명 다국어 대응 | 460개 | 한국어·영어·일본어·일본어 로마자 표기 |
| 시니어 다빈도 상병명 | 405개 | 직접 입력한 병명을 읽기 쉬운 표기로 정규화할 때 참고 |
| 약 사진 관찰 기준 | 10개 | 식별 전 확인할 관찰 항목과 안전 결정 규칙 |
| 식약처 낱알 품목 | 동기화 시 결정 | `MFDS_DATA_API_KEY`로 동기화한 공식 레코드 |

`food_aliases.json`과 일부 서비스용 지식은 현재 `data/sources` 변환 대상 밖에서 별도 관리합니다. 모든 JSON이 공식 데이터라고 오해하지 않도록 아래처럼 출처와 성격을 구분합니다.

## 데이터 출처와 이용 범위

| 구분 | 출처 | 실제 활용과 범위 |
| --- | --- | --- |
| 공공 언어 사전 참고 | [국립국어원 우리말샘](https://opendict.korean.go.kr) | 사투리·지역어·생활 언어 표기와 의미 확인. 서비스용 사투리 목록은 팀이 선별·검증해 별도 관리 |
| 공식 의약품 데이터 | [식품의약품안전처 의약품 낱알식별 정보](https://www.data.go.kr/data/15057639/openapi.do) | 제품명·각인·제형·모양·색·분할선·공식 이미지 URL 동기화. 공공데이터포털 이용허락범위 제한 없음 |
| 외부 최종 확인 | [약학정보원 의약품 식별검색](https://health.kr/searchIdentity/search.asp) | 사이트 자료를 복제·수집·재배포하지 않고 사용자가 직접 확인하는 링크로만 제공 |
| 팀 정리 자료 | [`data/sources`](./data/sources), [`data`](./data) | 식품·요리·별칭·건강 항목·안전 규칙을 서비스 목적에 맞게 정리. 공식 진단·처방 기준이 아닌 참고 데이터 |

### 원본과 생성물

`npm run prepare:data`는 아래 원본을 검증해 앱이 읽는 JSON을 다시 만듭니다.

- `data/sources/dialect_dictionary.csv`
- `data/sources/disease_i18n.csv`
- `data/sources/korean_dish_names.txt`
- `data/sources/recipes.json`
- `data/sources/senior_food_knowledge.py`
- `data/sources/senior_frequent_conditions.txt`

변환 과정은 한 글자 사투리, 자기 자신으로 매핑되는 항목, 중복, 허용 범위를 벗어난 지역·분류 등을 검사합니다.

## 안전 설계

| 항목 | 구현 방식 |
| --- | --- |
| 위험도 하한선 | 등록 질병과 위험 식품이 함께 걸릴 때 코드가 최소 위험도를 보장 |
| 알레르기 | 등록 알레르기가 질문·재료에 직접 나타나면 모델 판정과 무관하게 위험 경고 |
| 과도한 제한 방지 | 밀 알레르기 때문에 소금까지 금지하는 식의 무관한 제한을 하지 않도록 구체 규칙 적용 |
| 의약품 식별 | 제품명 또는 각인이 맞는 후보만 남기며 색·모양만으로 특정하지 않음 |
| 돌봄이 AI | 주제 제한은 풀되 공유 기록에 없는 증상·감정·사실을 추측하지 않음 |
| 의료 경계 | 진단·처방·임의 복약 지시를 하지 않고 위험하거나 불확실하면 전문가 확인 안내 |
| 서버 로그 | `/log`와 `/api/log`는 개발 환경 기본, 운영에서는 명시적으로 열지 않으면 비활성화 |

## 기술 구성

| 영역 | 구성 |
| --- | --- |
| 웹 | Next.js 16, React 19, TypeScript, Vinext/Vite |
| 실행·호스팅 | Cloudflare Workers |
| 연결 데이터 | Cloudflare D1 |
| 돌봄이 인증 | Firebase Authentication, 서버 검증 세션 쿠키 |
| AI | Gemini 텍스트·이미지·오디오·TTS, 모델 폴백과 429 재시도 |
| 로컬 저장 | IndexedDB |
| 선택형 방언 변환 | `backend/local_dialect` FastAPI 서버 |

## 프로젝트 구조

```text
.
├── .openai/
│   ├── hosting.json                       # Sites 프로젝트와 D1 논리 바인딩
│   └── drizzle/0001_caregiver_links.sql   # 돌봄이 연결·대화 D1 마이그레이션
├── app/
│   ├── api/
│   │   ├── auth/                          # Firebase 설정 조회와 서버 세션 발급·해제
│   │   ├── caregiver/
│   │   │   ├── overview/                  # 연결 시니어와 돌봄이 대화 목록
│   │   │   ├── link/                      # 일회용 코드 등록
│   │   │   ├── seniors/[seniorId]/        # 시니어 상세 조회·연결 해제
│   │   │   ├── threads/[threadId]/        # 돌봄이 대화 조회·삭제
│   │   │   └── chat/                      # 돌봄이 AI 대화
│   │   ├── senior/link/                   # 언어별 연결 코드 발급
│   │   ├── senior/sync/                   # 연결 이후 건강정보·대화 동기화
│   │   ├── chat/                          # 시니어 AI 답변
│   │   ├── transcribe/                    # 음성 인식·건강정보 분류
│   │   ├── tts/                           # 답변 음성 생성
│   │   └── log/                           # 개발용 지식 데이터 상태 API
│   ├── caregiver/
│   │   ├── page.tsx                       # 돌봄이 로그인·작업공간 진입
│   │   └── signup/page.tsx                # 이메일 회원가입
│   ├── log/page.tsx                       # 개발 전용 데이터 점검 화면
│   ├── globals.css                        # 시니어·소개·돌봄이 반응형 스타일
│   ├── layout.tsx                         # 메타데이터와 공통 레이아웃
│   └── page.tsx                           # 시니어 서비스 진입
├── frontend/
│   ├── SilverLensApp.tsx                  # 시니어 설정·대화·데이터·서비스 소개
│   ├── SeniorCareLinkPanel.tsx            # 언어별 일회용 연결 코드와 지속 공유
│   ├── CaregiverPortal.tsx                # 인증 상태에 따른 로그인·작업공간 전환
│   ├── CaregiverLogin.tsx                 # Google·이메일 로그인 UI
│   ├── CaregiverSignup.tsx                # 이메일 회원가입 UI
│   ├── CaregiverApp.tsx                   # 돌봄이 GPT형 대화·다중 시니어 관리
│   ├── firebaseAuth.ts                    # Firebase 클라이언트 초기화·인증 호출
│   ├── localStore.ts                      # IndexedDB 저장·백업·복구
│   ├── photoCapture.ts                    # 사진 축소와 밝기·흔들림 검사
│   └── DataLogView.tsx                    # 개발용 데이터 통계 화면
├── backend/
│   ├── config/env.ts                      # 환경변수·Gemini 모델 체인
│   ├── data/
│   │   ├── loadData.ts                    # 질문 관련 식품·규칙·의약품 후보 검색
│   │   ├── healthTerms.ts                 # 건강정보 ID와 다국어 표시명
│   │   └── diseaseI18n.ts                 # 질병명 다국어 정규화
│   ├── services/
│   │   ├── geminiClient.ts                # Gemini 호출·폴백·429 재시도
│   │   ├── geminiService.ts               # 시니어·돌봄이 답변과 안전 하한선
│   │   ├── transcriptionService.ts        # 음성 인식과 건강정보 추출
│   │   ├── ttsService.ts                  # 답변 음성 생성·캐시
│   │   ├── careData.ts                    # D1 연결·동기화·대화 저장
│   │   ├── caregiverAuth.ts               # Firebase 토큰 검증·세션 쿠키
│   │   └── caregiverRequest.ts            # 인증·동일 출처 요청 검사
│   └── local_dialect/                     # 선택형 FastAPI 방언 변환 서버
├── build/sites-vite-plugin.ts             # Sites 배포 산출물·마이그레이션 패키징
├── db/schema.ts                           # D1 테이블 정의
├── data/
│   ├── sources/                           # 사람이 편집하는 변환 원본 6종
│   ├── health_terms.json                  # 알레르기·질병 3개 언어 항목
│   ├── health_groups.json                 # 건강정보 선택 UI 그룹
│   ├── safety_rules.json                  # 질병·식품 위험도 규칙
│   ├── senior_food_knowledge.json         # 시니어 식품 지식
│   ├── recipes.json                       # 요리·재료 사전
│   ├── korean_dish_names.json             # 한식 대표명·변형
│   ├── global_dish_names.json             # 외국 음식 쉬운 풀이
│   ├── food_aliases.json                  # 외래어·별칭 정규화
│   ├── dialect_dictionary.json            # 검증된 사투리 사전
│   ├── disease_i18n.json                  # 질병명 다국어 대응
│   ├── senior_frequent_conditions.json    # 직접 입력 상병명 정규화
│   ├── drug_identification_reference.json # 약 사진 관찰·안전 기준
│   └── mfds_pill_identification.json      # 식약처 API 동기화 품목
├── docs/
│   ├── brand/                            
│   └── reference-images/                  # 연령·성별·언어·가이드 참고 이미지
├── public/
│   ├── guide/                             # 서비스 소개 사용법 이미지
│   ├── favicon.svg
│   └── og.png                             
├── scripts/
│   ├── build-verified.mjs                 
│   ├── validate-artifact.mjs             
│   ├── prepare_knowledge_data.py
│   ├── sync-mfds-pill-data.mjs
│   └── sites-env.sh                       # Sites 환경변수 보조 스크립트
├── tests/                                 # 안전·연결·렌더링·데이터 회귀 테스트
├── types/cloudflare-workers.d.ts         
├── worker/index.ts                        자산·이미지 최적화
├── vite.config.ts                         # Vinext·Cloudflare·Sites 빌드 설정
├── next.config.ts
├── eslint.config.mjs
├── tsconfig.json
├── package.json
└── .env.example                           # 키 이름만 있는 환경변수 예시
```

| 변수 | 용도 |
| --- | --- |
| `GEMINI_API_KEY` | 시니어·돌봄이 대화, 음성 인식, TTS |
| `GEMINI_TEXT_MODEL`, `GEMINI_TTS_MODEL` | 기본 모델 변경(선택) |
| `FIREBASE_API_KEY`, `FIREBASE_AUTH_DOMAIN`, `FIREBASE_PROJECT_ID`, `FIREBASE_APP_ID` | 돌봄이 로그인 |
| `AUTH_SESSION_SECRET` | 32자 이상의 무작위 서버 세션 서명값 |
| `NEXT_PUBLIC_DIALECT_API_URL` | 선택형 로컬 방언 변환 서버 |
| `MFDS_DATA_API_KEY` | 식약처 낱알 데이터 동기화 때만 사용; 배포 런타임에는 불필요 |

## 팀

구미전자공업고등학교 전자시스템제어과 · **우승에 동의**

| 이름 | 역할 |
| --- | --- |
| 박정찬 | 팀장, 프로젝트 아이디어, AI 프롬프트 설계 ,데이터 수집|
| 최수혁 | 백엔드·프론트엔드, AI 기능 구현  및 기능 기획|
| 김근호 | 프론트엔드, UI/UX |
| 이도현 | 저장소·배포 관리 , 데이터 수집 |

## 라이선스

서비스 소개에는 MIT License로 표기되어 있습니다. 현재 저장소에는 별도 `LICENSE` 원문 파일이 없으므로, 외부 배포·재사용 전 권리자명이 포함된 라이선스 파일을 추가해야 합니다. 외부 데이터와 연결 사이트의 자료에는 각 제공기관의 별도 이용 조건이 적용됩니다.
