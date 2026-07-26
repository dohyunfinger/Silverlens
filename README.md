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
│   └── safety_rules.json
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

`backend/data/loadData.ts`는 질문·알레르기·질병과 관련된 항목만 찾아 Gemini
답변 프롬프트에 넣습니다. 전체 자료를 매 요청마다 그대로 전송하지 않습니다.

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
명시하지 않은 건강정보는 자동으로 추측해 넣지 않도록 프롬프트를 제한합니다.
