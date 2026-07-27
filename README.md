# SilverLens

**'정의는 단순히 옳고 그름의 문제가 아니라 공동체의 선을 추구하는 행위, 자유와 평등에 더해서 우애 또는 연대성이라는 가치가 도입되어야 한다.'** 마이클 샌델이 말했습니다. 저희는 AI가 더 똑똑해지는 것보다, 사용자를 먼저 이해하고 사람간의 연대와 수치화 할수 없는 가치를 지켜주는 것이 진짜 발전된 기술이라고 생각합니다.
<br>**기술의 본질은 단순히 편리한 도구에 있는 것이 아니라, 인간과 세상을 연결하는 따뜻한 길이어야 한다고 생각합니다.**
SilverLens는 모든 것이 눈부시게 빨라지는 세상 속에서 소외된 어르신들의 삶을 돌아보고, 따뜻한 인공지능으로 세대 간의 단절을 메워나가는 시니어 맞춤형 AI 사이트입니다.

저희 팀은 처음에 '보이스피싱 예방 시스템'을 기획했습니다. 하지만 개발을 준비하면서 "이것이 과연 우리 할머니가 혼자 쓸 수 있는 다정한 기술인가?" 하는 근본적인 의문이 들었습니다. 노트북을 덮고 일주일 동안 가족들의 스마트폰 생활을 관찰하며, 우리는 책상 위에서는 보이지 않던 진짜 외로움과 장벽들을 발견했습니다.

**둔해진 손끝으로 작은 스마트폰 자판을 입력하는 어르신들에게 타이핑은 거대한 벽이었습니다.** 답답한 마음에 자판 대신 음성 인식을 켜보아도, 기존 AI들은 평생 삶의 흔적이 묻어난 깊은 사투리와 시장 언어(정구지, 정종 등)를 단지 '표준어가 아니다'라는 이유로 알아듣지 못하고 인식 오류만 냈습니다.

게다가 마트나 미디어에 쏟아지는 '로즈마리'나 '아보카도' 같은 낯선 외국 식재료들의 이름 앞에서 선뜻 손을 뻗지 못하고 망설이셨고, 인터넷에 떠도는 건강 정보를 무조건 신뢰하며 많이 먹을수록 좋다고 믿으시는 위험한 상황도 보았습니다.

> **기술의 속도가 노년의 걸음보다 빨라질 때, <br>어르신들은 기술을 거부하는 것이 아니라 기계 앞에서 서글픈 좌절감을 느끼고 계셨습니다. <br>현재의 기술은 어르신들이 기술을 못 쓰시는 게 아니라, 현재의 기술이 어르신들의 삶을 배려하지 않고 있었습니다.**

**사람을 소외시키는 기술은 결코 완성된 기술이 될 수 없습니다.** 저희 SilverLens는 어르신들이 기계의 규칙에 맞추는 것이 아니라, AI가 어르신의 삶을 먼저 이해하는 '눈과 귀'가 되고자 합니다. 디지털 격차를 해소하는 것을 넘어, 차가운 화면 속에서 따뜻한 사람의 온기를 전하는 사이트가 되는 것이 목표입니다.


# SilverLens의 핵심기술
**1. 사투리 찰떡 음성 인식**
<br>저희는 기술이 인간의 고유한 언어와 흔적을 존중해야 한다고 생각합니다. 
기존 AI는 표준어로 정확하게 발음하지 않으면 질문 자체를 거부합니다. SilverLens는 평생의 삶이 담긴 사투리와 생활 용어 데이터를 매핑하여, 어르신이 "이 정구지 어째 먹노?"라고 투박하게 말씀하셔도 그 안에 담긴 속뜻을 정확히 이해하고 손주처럼 다정하게 답변합니다. 

**2. 돋보기 카메라**
<br>지식의 나열보다 중요한 것은 한 사람을 향한 안전과 보호입니다.
기존 AI는 단순히 사진 속 사물의 이름만 딱딱한 데이터로 보여주고 끝냅니다. SilverLens는 카메라로 식재료를 비추면 낯선 외래어를 쉬운 우리말로 번역하고, 공공 영양 데이터와 연동하여 "할머니, 이 음식은 당뇨에 안 좋으니 조금만 드세요!" 하며 건강 맞춤형 안전 경고를 전달합니다. 

**3. 간단한 UI/UX와 손주 감성 음성**
<br>복잡한 메뉴와 카테고리는 어르신들에게 기술에 대한 두려움만 심어줄 뿐입니다. SilverLens는 어르신들의 인지 특성을 고려하여 복잡한 화면 구성을 직관적으로 단순화하고 글자 크기를 키웠습니다. 여기에 실제 손주의 목소리 톤을 학습한 TTS를 적용하여, 기계가 아닌 다정한 가족과 소통하는 듯한 정서적 안정감을 선물합니다.


# SilverLens 프로젝트 구조 및 아키텍처

## SilverLens란?

시니어가 음성·사진·글자로 식재료 정보를 질문하는 웹 서비스입니다.

## API 키 입력 위치

프로젝트 최상위 폴더에 `.env.local` 파일을 만들고 아래처럼 입력합니다.

```env
GEMINI_API_KEY=Google_AI_Studio에서_발급한_키
GEMINI_TEXT_MODEL=gemini-3.6-flash
GEMINI_TTS_MODEL=gemini-2.5-flash-preview-tts
NEXT_PUBLIC_DIALECT_API_URL=http://127.0.0.1:8001
DIALECT_MODEL_ID=sjbaek/gemma2-2b-it-korean-dialect
```

- 파일명: `.env.local`
- 전체 경로: `SilverLens/.env.local`
- 키 변수명: `GEMINI_API_KEY`
- `.env.local`은 `.gitignore`에 포함되어 GitHub에 업로드되지 않습니다.

## 전체 구조

```text
SilverLens/
├── .env.example
├── .env.local                  # 직접 생성: 실제 API 키
├── .gitignore
├── app/                        # Next.js 진입점과 서버 API
│   ├── api/
│   │   ├── chat/route.ts       # Gemini 대화 API
│   │   ├── transcribe/route.ts # 휴대폰·배포 환경 Gemini STT
│   │   └── tts/route.ts        # Gemini 2.5 Flash TTS API
│   ├── globals.css
│   ├── layout.tsx
│   └── page.tsx
├── frontend/
│   └── SilverLensApp.tsx       # 설정·대화·서비스·팀원 화면
├── backend/
│   ├── config/env.ts           # 환경변수 검사
│   ├── data/loadData.ts        # JSON 자료 메모리 캐시
│   ├── data/healthTerms.ts      # 다국어 건강정보 ID·표시명 연결
│   ├── services/
│   │   ├── geminiService.ts
│   │   ├── transcriptionService.ts
│   │   └── ttsService.ts
│   └── local_dialect/
│       ├── main.py             # Gemma 2 한국어 방언 변환 서버
│       └── requirements.txt
├── data/
│   ├── Knowledge.txt
│   ├── food_ingredient.txt
│   ├── dialect_dictionary.txt
│   ├── senior_food_knowledge.json
│   ├── food_ingredient.json
│   ├── dialect_dictionary.json
│   ├── dialect_terms.json
│   ├── food_aliases.json
│   ├── safety_rules.json
│   └── health_terms.json       # 한국어·영어·중국어 알레르기·질병명
├── scripts/
│   └── prepare_knowledge_data.py
├── package.json
└── tsconfig.json
```

`Knowledge.txt`, `food_ingredient.txt`, `dialect_dictionary.txt`가 원본 자료입니다.
다음 명령은 원본을 검색용 JSON으로 변환합니다.

```bash
npm run prepare:data
```

`backend/data/loadData.ts`는 현재 질문과 최근 대화에 실제로 언급된 식품명·별칭·
재료를 기준으로 관련 항목만 찾아 Gemini 답변 프롬프트에 넣습니다. 질병명만
일치한다는 이유로 장어 같은 무관한 식품 자료를 끌어오지 않습니다.

`data/health_terms.json`의 각 항목은 하나의 고정 ID와 한국어·영어·중국어
표시명을 가집니다. 음성 분류 결과는 표시 문구가 아니라 이 ID로 저장되므로
화면 언어를 바꾸면 같은 건강정보가 해당 언어로 다시 표시됩니다.

## VS Code 실행

프로젝트 폴더를 VS Code에서 연 뒤 터미널에서 환경 설정 파일을 만듭니다.

Windows PowerShell:

```powershell
Copy-Item .env.example .env.local
```

macOS/Linux:

```bash
cp .env.example .env.local
```

생성된 `.env.local`을 열어 `GEMINI_API_KEY` 값을 입력합니다.

Node.js 웹 서버:

```bash
npm install
npm run dev
```

브라우저에서 `http://localhost:3000`을 엽니다.

로컬 Gemma 방언 변환 서버는 새 터미널에서 실행합니다.

```bash
python -m venv .venv
```

Windows:

```powershell
.\.venv\Scripts\Activate.ps1
pip install -r backend/local_dialect/requirements.txt
uvicorn backend.local_dialect.main:app --host 127.0.0.1 --port 8001
```

macOS/Linux:

```bash
source .venv/bin/activate
pip install -r backend/local_dialect/requirements.txt
uvicorn backend.local_dialect.main:app --host 127.0.0.1 --port 8001
```

첫 방언 변환 요청 때 Hugging Face에서 모델 파일을 내려받고 메모리에 올리므로
시간이 걸릴 수 있습니다. 이후 요청은 같은 프로세스의 모델을 재사용합니다.

## AI 구성

- 언어 모델: Gemini 3.6 Flash
- 음성 인식 및 건강정보 분류: Gemini 오디오 입력
- 로컬 방언→표준어 변환: `sjbaek/gemma2-2b-it-korean-dialect`
- 배포 환경 방언 해석: `data/dialect_dictionary.txt` 검색 결과와 Gemini
- 설정·추천 안내: Web Speech API 기반 브라우저 TTS
- AI 답변 음성: Gemini 2.5 Flash TTS
- AI 답변 음성 예비 수단: Web Speech API 기반 브라우저 TTS

AI 답변 음성은 짧은 문장 묶음으로 동시에 준비하고 브라우저 메모리에 보관합니다.
같은 답변을 다시 들을 때는 이미 준비된 음성을 재사용하므로 다시 변환하지 않습니다.
화면에서는 답변을 큰 글자 카드로 나누고, 왼쪽은 이전 대화, 오른쪽은 이어지는
답변과 새 대화 순서로 이동합니다. 한 카드의 TTS 재생이 끝나면 다음 카드로
자동 이동해 이어서 읽습니다. Gemini TTS 요청이 실패하거나 API 키가 없으면
브라우저 TTS로 전환하며, 이 경우에도 카드가 자동 이동합니다.

건강정보 음성은 AI가 음성 전체를 확인한 뒤 알레르기와 질병을 분리합니다.
AI가 반환한 항목은 `health_terms.json`에 실제로 등록된 ID인지 서버에서 다시
검사합니다. 명시하지 않은 정보나 카탈로그에 없는 임의 값은 자동 입력하지 않습니다.

대화 API는 최근 6개의 질문과 답변을 다음 요청에 함께 전달합니다. “레시피
알려줘”처럼 주어가 생략된 후속 질문은 가장 최근 음식 주제를 이어서 해석하도록
프롬프트를 제한합니다.

답변은 `answer`, `riskLevel`, `warningMessage` 구조로 반환됩니다. 등록된
알레르기 식품이 현재 질문 또는 이어지는 대화 주제에 직접 포함되면 코드가
`danger`를 우선 적용해 답변 카드 상단에 빨간 경고를 표시합니다.

자동 음성 안내 버튼은 켜짐·꺼짐 상태를 브라우저에 저장합니다. 꺼짐일 때는
단계 안내와 새 답변이 자동 재생되지 않지만 `안내 다시 듣기`와
`답변 다시 듣기`는 계속 사용할 수 있습니다.

# 디지털 세상의 소외를 지우는 빛, SilverLens
> **저희가 생각하는 가장 좋은 기술은 인간을 가르치려 들지 않고, 가장 낮은 곳에서 인간을 닮아가는 기술이라고 믿습니다.**

<br>**기술이 고도화될수록 소외받는 어르신들이 생겨난다면, 고등학생인 저희가 배운 기술로 그 격차를 가장 따뜻하게 메워보고 싶습니다.** 대한민국 모든 어르신들이 타인의 도움 없이도 당당하고 안전하게 디지털 세상을 누릴 수 있도록, 저희 SilverLens 팀은 기술에 마음을 담는 발걸음을 멈추지 않겠습니다.