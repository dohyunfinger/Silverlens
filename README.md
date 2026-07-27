# SilverLens

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
