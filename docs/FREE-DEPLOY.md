# 무료 방식으로 배포하기

기본 구성은 **Firebase Spark + Netlify Free + Google Drive**입니다. Firebase는 구글 로그인과 경력 메타데이터를, Netlify는 화면·API·비공개 인증 보관함을, Google Drive는 공문 원본과 날짜별 백업을 맡습니다. Firebase Storage, Firebase Cloud Functions, Blaze 요금제, 서비스 계정 키와 IAM 설정은 이 방식에 필요하지 않습니다.

무료 플랜의 제공 범위 안에서 사용합니다. Netlify 사이트가 속한 팀의 플랜과 Usage 화면, Google Drive의 남은 용량을 확인하세요. 유료 플랜 전환이나 결제 설정을 기본 절차에 포함하지 않습니다. 서비스 한도를 넘으면 해당 작업을 중단하고 앱에서 오류를 확인합니다. 현재 플랜별 수치를 코드에 고정하거나 무제한 사용을 보장하지 않습니다.

이 문서는 순서대로 진행하는 안내입니다. 실제 사이트와 계정 연결을 확인하기 전까지 배포·백업 완료로 간주하지 않습니다.

## 1. Firebase에서 로그인과 데이터베이스 준비

[Firebase Console](https://console.firebase.google.com/)의 이 앱 전용 프로젝트를 사용합니다. 요금제는 **Spark**로 유지합니다.

- Authentication → 로그인 방법에서 Google을 사용 설정합니다.
- Firestore Database → 데이터베이스 만들기를 누릅니다. 에디션 선택이 나오면 **Standard**를 선택합니다.
- 데이터베이스 ID는 `(default)`를 사용합니다. 새 데이터베이스 위치는 서울 `asia-northeast3`을 우선 검토하며 기존 데이터베이스 위치는 변경하지 않습니다.
- 보안 모드 선택이 나오면 **프로덕션 모드**로 시작합니다. 이후 본인 계정 전용 규칙을 적용합니다. 테스트 모드의 전체 공개 규칙을 사용하지 않습니다.
- 프로젝트 설정 → 내 앱에서 웹 앱을 등록합니다. SDK의 `firebaseConfig` 객체만 `.cloud-local/firebase-web-config.json`에 JSON 형식으로 저장합니다. `const firebaseConfig =` 같은 JavaScript 코드는 제외합니다.

Firebase 웹 앱 설정의 API 키는 브라우저에서 사용하는 공개 식별자입니다. AI 키, OAuth 비밀값, 서비스 계정 JSON을 이 설정에 섞지 않습니다.

## 2. Netlify의 실제 사이트 주소 확인

Netlify Free 팀에 이 앱용 사이트를 만듭니다. 기존 다른 앱의 사이트를 덮어쓰지 않습니다. 사이트의 실제 HTTPS 주소와 사이트 ID를 기록합니다.

Firebase Authentication → 설정 → 승인된 도메인에 Netlify 사이트의 **호스트 이름**을 추가합니다. 예를 들어 `https://SITE.netlify.app`이면 `SITE.netlify.app`만 입력합니다. 기본 Firebase 인증 도메인은 유지합니다. 사용자 도메인을 연결하면 해당 도메인도 추가합니다.

API는 같은 사이트의 `/api` 경로로 요청합니다. 별도 Firebase Functions 주소나 Storage 버킷은 만들지 않습니다.

## 3. 본인 계정용 설정 생성

기존 체크아웃에서 작업합니다. 별도 Git worktree는 필요 없습니다. 다음 자리표시자를 실제 프로젝트 ID·사이트 주소·본인 구글 이메일로 바꿉니다.

```sh
cd /workspace/me
npm ci --cache /workspace/.cache/npm
node scripts/prepare-cloud-config.mjs \
  --project PROJECT_ID \
  --site https://ACTUAL_SITE.netlify.app \
  --owner YOUR_GOOGLE_EMAIL \
  --web-config .cloud-local/firebase-web-config.json
```

생성 파일은 모두 Git에서 제외됩니다.

- `.env.production.local`: 공개 Firebase 웹 설정, `VITE_CLOUD_MODE=true`, `VITE_DEPLOYMENT_MODE=free`.
- `.cloud-local/netlify-server.env`: 본인 이메일과 실제 앱 주소 등 Netlify 서버 변수. OAuth·AI 비밀값은 포함하지 않습니다.
- `.cloud-local/firestore.rules`: 본인 이메일에 맞춘 비공개 Firestore 규칙.

기존 설정 파일이 있으면 명령이 중단되며 기존 값은 보존합니다. 변경할 변수만 직접 수정하세요. 스크립트는 배포·Google API 활성화·외부 권한 변경을 실행하지 않습니다. `--bucket`, `--api-url`, `--service-account`, `--region`은 무료 방식에서 받지 않습니다. 유료 경로는 명시적으로 `--mode paid`를 선택했을 때만 열립니다.

## 4. Firestore 보안 규칙 적용

**새 앱 전용 프로젝트**에서 `.cloud-local/firestore.rules` 내용을 검토한 뒤 Firestore → 규칙 화면에 붙여넣고 게시합니다. 저장소의 기본 `firestore.rules`는 설정 전 전체 차단 상태이며 그대로 사용하면 경력을 저장할 수 없습니다.

생성 규칙은 다음 조건을 모두 확인합니다.

- 본인 구글 이메일이며 이메일 확인을 마친 Google 로그인이어야 합니다.
- 로그인 UID와 `careerArchives/{uid}`의 UID가 같아야 합니다.
- 루트 기록은 `activeVersion`과 `revision`만 저장하며 첫 revision은 1입니다.
- 활성 버전의 경력·공문을 수정할 때 같은 트랜잭션에서 revision을 1 올려야 합니다.
- 새 버전에 복원 데이터를 먼저 준비한 뒤 revision 확인과 활성 버전 전환을 함께 처리합니다.

구체적인 데이터 경로는 `careerArchives/{uid}`, 그 아래 `versions/{version}/careers/{id}`와 `versions/{version}/documents/{id}`입니다. 다른 사용자나 다른 컬렉션의 직접 접근은 차단합니다. OAuth 토큰과 암호화 키는 Firestore에 저장하지 않습니다.

기존 Firebase 프로젝트에 적용할 때는 현재 규칙을 먼저 읽고 다른 앱의 정책을 보존하며 병합해야 합니다. 여러 규칙 중 하나가 허용하면 접근이 가능하므로 기존의 넓은 허용 규칙이 이 앱 경로까지 열지 않는지도 확인합니다.

## 5. Netlify 환경 변수와 배포

Netlify 사이트 → 환경 변수에서 다음을 등록합니다. 공개 `VITE_*` 값은 빌드에서, 서버 변수는 Functions 실행에서 사용할 수 있어야 합니다.

| 구분 | 값의 위치와 필요한 이름 |
| --- | --- |
| 화면 | `.env.production.local`의 `VITE_*` 값. `VITE_DEPLOYMENT_MODE=free` 유지 |
| 서버 | `.cloud-local/netlify-server.env`의 `APP_URL`, `OWNER_EMAIL`, `APP_FIREBASE_PROJECT_ID`, `APP_FIREBASE_WEB_API_KEY`, 기능 사용 여부 |
| Drive 연결 | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `APP_DRIVE_ENABLED=true` |
| 선택 AI | `APP_GEMINI_KEY`, `APP_AI_ENABLED=true`, 선택적으로 `APP_GEMINI_MODEL` |

`GOOGLE_CLIENT_SECRET`과 `APP_GEMINI_KEY`는 Netlify의 서버 환경 변수에서 입력합니다. 채팅, GitHub, `VITE_*` 변수에 넣지 않습니다. 비공개 Netlify Blobs에 암호화된 연결 토큰과 내부 암호화 키를 보관하므로 별도 서비스 계정 키나 `APP_ENCRYPTION_KEY`를 요구하지 않습니다.

`netlify.toml`은 화면을 `dist`에서, API를 `netlify/functions`에서 배포합니다. `/api/*` 규칙이 SPA 규칙보다 먼저 적용됩니다. API 함수는 Firebase ID 토큰과 본인 이메일을 검증합니다. Blobs는 현대 Netlify Functions의 서버 컨텍스트에서 강한 일관성으로 사용하며 브라우저에 Netlify 접근 토큰을 전달하지 않습니다.

```sh
cd /workspace/me
npm run build
npm test
npx netlify-cli login
npx netlify-cli deploy --site="$NETLIFY_SITE_ID" --prod --build
```

`--build`는 화면과 **Netlify Functions를 함께** 준비합니다. `dist`만 업로드하면 API와 백업 함수가 빠질 수 있습니다. Netlify CLI를 쓰는 머신에는 Node.js 24 이상을 사용합니다. CLI 로그인은 본인 컴퓨터에서 진행하며, 클라우드 환경 밖에서는 저장소·npm 캐시 경로를 본인 머신에 맞춥니다. PDF의 네이티브 의존성이 배포 환경과 맞도록 직접 번들 빌드는 검증한 Linux x64 환경을 사용합니다. 다른 운영체제의 컴퓨터에서는 GitHub 연결을 통한 Netlify 클라우드 빌드를 사용합니다.

GitHub 자동 배포를 선택하면 변경 내용을 검토한 뒤 본인의 절차로 반영합니다. `.env.production.local`은 GitHub에 전달되지 않으므로 Netlify 빌드 환경 변수 설정이 필요합니다. 이 안내와 로컬 도구는 GitHub 커밋·푸시·실제 서비스 배포를 자동으로 실행하지 않습니다.

## 6. Google Drive 연결

같은 Google Cloud 프로젝트에서 Google Drive API를 활성화하고 OAuth 동의 화면과 **웹 애플리케이션** 유형의 클라이언트를 설정합니다. Google Auth Platform 화면에서는 브랜드·대상·클라이언트 항목에서 설정할 수 있습니다. 개인 테스트 상태에서는 본인 구글 계정을 테스트 사용자에 추가합니다.

승인된 리디렉션 URI는 실제 Netlify 주소의 **`/api/auth/callback`**입니다.

```text
https://ACTUAL_SITE.netlify.app/api/auth/callback
```

`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `APP_DRIVE_ENABLED=true`를 Netlify Functions 환경에 등록하고 반영한 뒤 앱의 백업 및 설정에서 Drive를 연결합니다. `drive.file` 범위로 앱이 만든 원본과 백업을 다룹니다. 본인과 다른 Google 계정은 연결하지 않습니다.

공문 원본은 브라우저에서 Drive로 직접 업로드·다운로드하므로 큰 파일이 Netlify API 응답을 통과하지 않습니다. 앱에서 공문 기록을 삭제해도 이미 보관한 Drive 원본은 유지해 이전 백업의 증빙 연결을 보존합니다. OAuth 동의 화면이 테스트 상태이면 Google 정책에 따라 연결 토큰이 만료되어 다시 연결해야 할 수 있습니다.

## 7. 자동 백업과 전체 ZIP

자동 백업 함수의 시간은 `0 18 * * *` UTC이며 **매일 한국시간 오전 3시**입니다. 배포된 사이트에서 실행됩니다. 자동 백업은 작은 날짜별 `career-drive-snapshot` JSON을 Drive에 남깁니다. 경력 정보, 공문 정보, Drive 원본 파일 ID와 SHA256을 함께 보관하고 이전 백업을 덮어쓰지 않습니다. JSON 복원은 원본을 확인하고 SHA를 검증한 뒤 경력 데이터를 교체합니다.

자동 JSON과 Drive에 유지한 원본을 함께 사용해 복원합니다. Drive에서 원본을 직접 삭제하면 그 파일을 참조하는 과거 JSON의 증빙을 복원할 수 없습니다. 원본을 포함한 **전체 ZIP은 브라우저에서 수동으로 만들고 컴퓨터에 다운로드**합니다. ZIP을 Drive에도 보관하려면 내려받은 파일을 본인이 Drive에 별도로 올립니다. 앱의 ‘지금 Drive 백업’은 작은 JSON 백업입니다. 서버에서 큰 ZIP을 만드는 기본 예약 작업은 사용하지 않습니다.

기존 PDF에서 정리한 65개 후보의 원문 PDF·ZIP·경력 목록은 공개 소스와 화면 번들에 포함하지 않습니다. `.cloud-local/initial-career-backup.zip`을 본인 컴퓨터로 옮긴 뒤 로그인 후 백업 및 설정 → 복원에서 가져옵니다. 이 초기 후보에는 실제 공문 원본이 없으므로 원본은 별도로 업로드합니다. 복원은 현재 기록을 교체하므로 기존 데이터가 있다면 먼저 전체 ZIP을 보관하세요.

채팅에서 ZIP 파일을 받을 수 없다면 **백업 코드**로 가져올 수 있습니다. 백업 및 설정의 백업 코드 입력란에 전달받은 코드를 붙여넣고 **백업 코드로 복원 → 전체 기록 복원**을 누릅니다. 기존 ZIP과 같은 검사와 복원 절차를 사용하며, 확인 창에서 취소하면 기록을 바꾸지 않습니다. 코드는 경력 정보를 포함하므로 개인 ZIP처럼 공개 소스와 배포 번들에서 제외합니다. 입력한 코드는 브라우저의 별도 저장소에 보관하지 않습니다.

짧은 `IMBK2` 코드는 무작위 AES-256-GCM 키로 암호화한 ZIP을 앱에서 가져옵니다. `public/imports`에는 암호문만 배포하며 원본과 키는 `.cloud-local`에 보관하고 Git에서 제외합니다. 키는 본인에게 비공개로 전달하고 브라우저에서만 복호화에 사용합니다. 암호문 다운로드 요청에 키를 보내지 않습니다. 파일 변조·잘못된 키·복원 파일 구조를 확인한 뒤 기존 복원 확인창을 거쳐 기록을 저장합니다.

Google Drive 무료 용량은 계정의 다른 파일과 공유합니다. 원본과 날짜별 백업이 남아 있는 만큼 용량을 사용하며 자동 삭제 정책은 적용하지 않습니다. 예약 백업 성공 시각과 오류를 앱에서 확인하고, 독립적인 사본이 필요할 때 전체 ZIP을 컴퓨터에 내려받아 보관합니다.

## 8. 선택 사항: 무료 AI

기본 규칙 분석은 외부 API 연결 없이 사용할 수 있습니다. AI 분석을 원하면 [Google AI Studio](https://aistudio.google.com/)에서 결제 연결이 없는 무료 사용 범위의 Gemini 키를 마련하고 `APP_GEMINI_KEY`를 Netlify 서버 변수에 입력합니다. `APP_AI_ENABLED=true`로 켜며 기본 모델은 `gemini-2.5-flash`입니다. 모델별 무료 제공 범위는 [Gemini 가격 안내](https://ai.google.dev/gemini-api/docs/pricing)에서 확인합니다.

문서·이미지 내용은 Google AI 서비스로 전송됩니다. 무료 한도 또는 분석 오류가 발생하면 규칙 기반 초안으로 돌아가며 결과에 표시합니다. OpenAI 유료 API 키는 무료 기본 구성에 요구하지 않습니다. 어떤 분석 방식이든 본인이 확인·수정한 뒤 경력을 저장합니다.

## 실제 사이트에서 확인할 것

본인 로그인 후 경력을 등록하고 새로고침·다른 컴퓨터에서 유지되는지 확인합니다. 다른 계정의 Firestore/API 접근이 거절되는지도 확인합니다. Drive 원본 업로드·중복 검사·경력 연결·다운로드, HWPX 양식 입력, 수동 전체 ZIP 및 자동 JSON 백업·복원을 테스트 데이터로 확인합니다. 기존 개인정보를 바꾸는 복원 시험 전에 현재 전체 ZIP을 보관합니다.

로컬 테스트, 번들 생성, 설정 파일 저장은 실제 로그인·Drive 연결·예약 실행을 검증한 것과 구분합니다. Netlify의 임시 미리보기 주소는 고정된 `APP_URL`과 다르므로 계정·OAuth 확인은 실제 사이트 주소에서 진행합니다.

참고: [Netlify Blobs 공식 소스](https://github.com/netlify/primitives/tree/main/packages/blobs), [Netlify Functions 공식 소스](https://github.com/netlify/primitives/tree/main/packages/functions), [Netlify 요금제](https://www.netlify.com/pricing/). 현재 SDK 요구사항과 API 형태는 공식 패키지·소스로 확인했으며, 플랜별 최신 사용 한도는 본인 계정의 Netlify 화면에서 확인해야 합니다.
