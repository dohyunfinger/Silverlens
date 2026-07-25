# SilverLens

시니어가 음성·사진·글자로 식재료 정보를 질문하는 웹 서비스입니다.

## API 키 입력 위치

프로젝트 최상위 폴더에 `.env.local` 파일을 만들고 아래처럼 입력합니다.

```env
GEMINI_API_KEY=Google_AI_Studio에서_발급한_키
GEMINI_TEXT_MODEL=gemini-2.5-flash
GEMINI_TTS_MODEL=gemini-2.5-flash-preview-tts
NEXT_PUBLIC_STT_API_URL=http://127.0.0.1:8000
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
│   │   └── ttsService.ts
│   └── local_stt/
│       ├── main.py             # faster-whisper 로컬 서버
│       └── requirements.txt
├── data/
│   ├── dialect_terms.json
│   ├── food_aliases.json
│   └── safety_rules.json
├── package.json
└── tsconfig.json
```

`data/*.json`은 `backend/data/loadData.ts`가 최초 요청 때 읽고 메모리에 보관합니다.

## VS Code 실행

Node.js 웹 서버:

```bash
npm install
npm run dev
```

브라우저에서 `http://localhost:3000`을 엽니다.

faster-whisper 로컬 STT 서버는 새 터미널에서 실행합니다.

```bash
python -m venv .venv
```

Windows:

```powershell
.\.venv\Scripts\Activate.ps1
pip install -r backend/local_stt/requirements.txt
uvicorn backend.local_stt.main:app --reload --port 8000
```

macOS/Linux:

```bash
source .venv/bin/activate
pip install -r backend/local_stt/requirements.txt
uvicorn backend.local_stt.main:app --reload --port 8000
```

## AI 구성

- 언어 모델: Gemini API
- 음성 인식: faster-whisper 로컬 서버
- 설정·추천 안내: Web Speech API 기반 브라우저 TTS
- AI 답변 음성: Gemini 2.5 Flash TTS
- AI 답변 음성 예비 수단: Web Speech API 기반 브라우저 TTS

긴 AI 답변은 문장 단위로 나누어 음성을 생성한 뒤 하나의 WAV로 이어 붙입니다.
화면에서는 답변을 큰 글자 카드로 나누고, 왼쪽은 이전 대화, 오른쪽은 이어지는
답변과 새 대화 순서로 이동합니다. Gemini TTS 요청이 실패하거나 API 키가 없으면
브라우저 TTS로 자동 전환합니다.
