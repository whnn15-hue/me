# Netlify → Vercel 이전

2026-11-11에 사용자가 배포 횟수 한도 때문에 호스팅을 Vercel로 옮기기로 결정했습니다. 작업 브랜치는 `claude/vercel-onedrive`이며 `preview/resource-library`(`0baaa42`)에서 시작했습니다. 이 문서의 변경은 **아직 `main`에 반영하지 않았고, 실제 Vercel 프로젝트도 만들지 않았습니다.** 사용자가 Vercel 계정을 연결하고 정식 배포를 요청하기 전까지 Netlify 사이트가 그대로 운영본입니다.

## 무엇이 바뀌나

| 구성 | Netlify (현재) | Vercel (이전 후) |
|---|---|---|
| 화면 | `dist` | 같음 (`outputDirectory: dist`) |
| API | `netlify/functions/career-api.mjs` | `api/career-api.mjs` (공통 코드 `server/free/*` 그대로) |
| AI 연결 검사 | Background Function, 202 응답 후 계속 실행 | `api/career-ai-background.mjs`, 202 응답 후 `waitUntil`로 계속 실행 (최대 120초) |
| 매일 백업 | Scheduled Function `0 18 * * *` (UTC, 한국 03:00) | Vercel Cron 같은 시각, `CRON_SECRET` 필수 |
| 비공개 보관함 | Netlify Blobs | Upstash Redis (Vercel Marketplace 무료 요금제) |
| 미리보기 | Deploy Preview 설정은 미완료 | Preview 배포는 자동으로 격리 미리보기 앱을 빌드 |
| 이력 데이터 | Firestore | **그대로** |
| 로그인 | Firebase Google 로그인 | **그대로** (승인된 도메인만 추가) |

`netlify.toml`과 `netlify/` 폴더는 지우지 않았습니다. 이전을 확인할 때까지 Netlify 배포도 계속 동작합니다.

## 미리보기 격리

- `scripts/vercel-build.mjs`는 `VERCEL_ENV=production`일 때만 실제 앱을 빌드합니다. 그 밖의 모든 Vercel 배포(브랜치, PR)는 `build:preview`와 같은 격리 미리보기를 `dist`에 빌드하고 Firebase 공개 설정까지 지웁니다.
- `server/vercel/entry.mjs`는 Production이 아닌 배포에서 API를 403으로 막고, 예약 백업은 실행하지 않습니다. 빌드 설정이 잘못돼도 실제 데이터에 닿지 않도록 이중으로 막습니다.
- 환경 변수는 Vercel에서 **Production에만** 넣습니다. Preview에는 넣지 않습니다.

## 사용자가 할 일 (순서대로)

1. [vercel.com](https://vercel.com)에 GitHub 계정으로 가입합니다. 요금제는 **Hobby(무료)**입니다.
2. **Add New → Project**에서 `whnn15-hue/me`를 가져옵니다.
   - Framework Preset은 **Other**로 둡니다. 빌드 명령과 출력 폴더는 `vercel.json`이 정합니다.
   - Production Branch는 `main`입니다. 가져오는 즉시 현재 `main`(Netlify용 코드)이 한 번 빌드될 수 있습니다. 환경 변수가 없으므로 실제 데이터에는 접근하지 않습니다.
   - Settings → Functions에서 **Fluid Compute가 켜져 있는지** 확인합니다. 꺼져 있으면 Hobby의 최대 실행 시간이 짧아 AI 연결 검사(120초)가 배포 단계에서 거절될 수 있습니다.
3. **Storage → Marketplace → Upstash for Redis**를 무료 요금제로 만들고 이 프로젝트의 **Production**에 연결합니다. `KV_REST_API_URL`, `KV_REST_API_TOKEN`이 자동으로 추가됩니다.
4. Settings → Environment Variables에 **Production 전용**으로 입력합니다. 값은 기존 Netlify 환경 변수와 `.cloud-local/` 파일에서 옮깁니다. 채팅에 붙여 넣지 않습니다.
   - 서버: `APP_URL`(Vercel 주소, 끝에 `/` 없음), `OWNER_EMAIL`, `APP_FIREBASE_PROJECT_ID`, `APP_FIREBASE_WEB_API_KEY`, `APP_DRIVE_ENABLED`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `APP_AI_ENABLED`, `APP_GEMINI_KEY`(선택), `APP_GEMINI_MODEL`(선택)
   - 예약 백업: `CRON_SECRET` — 32자 이상 무작위 문자열. 예: 터미널에서 `openssl rand -hex 32`
   - 화면(빌드 시 사용): `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_STORAGE_BUCKET`(있으면). `VITE_CLOUD_MODE` 등 모드 값은 빌드 스크립트가 넣습니다.
   - OneDrive로 바꿀 때 추가 변수는 [ONEDRIVE.md](ONEDRIVE.md)를 따릅니다.
5. Firebase Console → Authentication → 설정 → 승인된 도메인에 `프로젝트이름.vercel.app`을 추가합니다.
6. Google Drive를 계속 쓰는 동안에는 Google Cloud OAuth 클라이언트의 승인된 리디렉션 URI에 `https://프로젝트이름.vercel.app/api/auth/callback`을 추가합니다.
7. 이 브랜치를 GitHub에 올린 뒤 Vercel이 만든 **Preview 주소**에서 격리 미리보기를 확인합니다.
8. 정식 전환을 요청하면 승인된 변경을 `main`에 한 번 반영합니다. Vercel Production 배포 성공과 화면 버전을 확인한 뒤 Netlify의 자동 게시를 멈춥니다.

## 옮겨지지 않는 것

Netlify Blobs 안의 비공개 보관함(드라이브 연결 토큰, 저장된 Gemini 키, 백업 오류 기록)은 Vercel로 복사하지 않습니다. 복호화 키가 Netlify 안에만 있기 때문입니다. 전환 후 앱에서 **저장소를 다시 연결**하고 **Gemini 키를 다시 등록**하면 됩니다. Firestore의 이력과 드라이브 원본 파일은 영향을 받지 않습니다.

## 검증한 것 / 하지 않은 것

- `test/vercel.test.mjs`: Redis 보관함의 조건부 쓰기, 암호화 보관함 동작, 경로 복원, Production 외 차단, `CRON_SECRET` 검사, AI 202 처리, `vercel.json`과 `netlify.toml`의 경로·헤더·일정 일치.
- Vercel CLI `vercel build --prod`를 계정 없이 로컬에서 실행해 함수 3개, PDF 처리용 `pdfjs-dist`·`@napi-rs/canvas` 포함, 경로 순서, Cron 등록을 확인했습니다.
- 실제 Vercel 배포, Upstash 연결, Firebase 로그인, 예약 실행은 **확인하지 않았습니다.** 계정 연결 후 Preview와 Production에서 각각 확인해야 합니다.

## 되돌리기

Vercel 전환 후 문제가 생기면 Netlify 자동 게시를 다시 켜고 Firebase 승인된 도메인의 Netlify 주소를 유지하면 됩니다. 이 브랜치의 변경은 Netlify 동작을 바꾸지 않습니다. Netlify에서 쓰던 Blobs 보관함도 그대로 남아 있습니다.
