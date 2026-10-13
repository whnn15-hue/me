# 선택 사항: 유료 Firebase Functions + Netlify 배포

현재 기본 구성은 [무료 배포 안내](FREE-DEPLOY.md)의 Firebase Spark + Netlify 방식입니다. 이 문서는 사용자가 유료 방식을 별도로 선택했을 때만 적용합니다. 무료 환경을 만드는 과정에서는 Blaze 전환·Firebase Storage·Firebase Functions·IAM 변경을 실행하지 않습니다.

Netlify는 화면을 제공하고, Firebase Authentication의 구글 로그인으로 본인을 확인합니다. Firebase Functions `careerApi`만 경력과 공문에 접근하며 Firestore에 경력·연결 정보를, Cloud Storage에 원본을 보관합니다. 브라우저는 Firestore/Storage SDK로 데이터를 직접 읽거나 수정하지 않습니다. 업로드와 다운로드에는 인증된 API가 발급한 짧은 유효기간의 Storage URL을 사용합니다.

현재 저장소에는 배포용 코드와 설정이 준비되어 있습니다. Firebase 프로젝트·Netlify 사이트 생성, 실제 로그인·저장·백업 검증은 배포 후에 진행해야 합니다. 개발 환경에서 프로세스를 실행하거나 환경 설정을 게시하는 작업은 웹앱 배포와 별개입니다.

## 프로젝트 준비

1. [Firebase Console](https://console.firebase.google.com/)에서 이 앱 전용 **새 프로젝트**를 만듭니다. 프로젝트 이름과 프로젝트 ID는 본인이 정합니다. Google Analytics는 이 앱에 필수가 아닙니다.
2. Functions와 Storage 사용을 위해 Blaze 요금제로 연결합니다. [Functions 시작 안내](https://firebase.google.com/docs/functions/get-started?gen=2nd)와 [Storage 요금제 변경 안내](https://firebase.google.com/docs/storage/faqs-storage-changes-announced-sept-2024)를 참고하세요. Functions·저장 공간·네트워크·외부 AI 사용량에 따라 비용이 발생합니다.
3. Authentication → 로그인 방법에서 Google을 사용 설정합니다. 지원 이메일을 지정합니다. 본인만 사용하는 제한은 서버의 `OWNER_EMAIL` 검증으로 적용합니다.
4. Firestore Database와 Storage 기본 버킷을 만듭니다. 새 프로젝트는 서울 리전을 우선 검토합니다. 이 저장소의 Functions 기본 리전은 `asia-northeast3`이며 `--region`으로 바꿀 수 있습니다. 기존 데이터베이스의 위치는 변경하지 마세요.
5. 프로젝트 설정 → 내 앱에서 웹 앱을 등록하고 SDK 설정의 `firebaseConfig` **객체만** JSON으로 저장합니다. 예: `.cloud-local/firebase-web-config.json`. `const firebaseConfig =` 같은 JavaScript 구문은 제외합니다. 이 설정은 공개 웹 앱 설정이며 서비스 계정 JSON과 다릅니다. 서비스 계정 개인 키를 내려받거나 앱에 넣을 필요가 없습니다.
6. Netlify에서 이 앱용 새 사이트를 생성합니다. 사이트의 실제 HTTPS 주소를 확인합니다. 기존에 다른 앱을 운영하는 사이트를 덮어쓰지 마세요.

Firebase Authentication → 설정 → 승인된 도메인에 Netlify 주소의 **호스트 이름**을 추가합니다. 기본 `PROJECT_ID.firebaseapp.com` 인증 도메인도 유지합니다. 직접 지정한 사이트 도메인을 사용하면 그 도메인도 등록합니다. 원치 않는 계정이 로그인하더라도 `careerApi`는 본인의 이메일 및 확인된 구글 로그인만 허용합니다.

## 로컬 배포 설정 만들기

Node.js 24 이상에서 저장소의 기존 체크아웃을 사용합니다. 별도 Git worktree는 필요 없습니다. 아래 대문자 값은 실제 프로젝트·사이트 정보를 입력할 자리이며 그대로 실행하면 안 됩니다.

```sh
cd /workspace/me
npm ci --cache /workspace/.cache/npm
node scripts/prepare-cloud-config.mjs \
  --mode paid \
  --project PROJECT_ID \
  --bucket BUCKET_NAME \
  --site https://ACTUAL_SITE.netlify.app \
  --owner YOUR_GOOGLE_EMAIL \
  --web-config .cloud-local/firebase-web-config.json
```

버킷 이름은 콘솔에 표시되는 실제 값입니다. `PROJECT_ID.firebasestorage.app` 또는 이전 형식의 `PROJECT_ID.appspot.com`이라고 추측하지 마세요. 스크립트는 웹 앱 설정의 프로젝트·버킷과 일치하는지 확인합니다. 리전을 바꾸려면 `--region REGION`을 추가합니다. 기본 API 주소는 `https://REGION-PROJECT_ID.cloudfunctions.net/careerApi`입니다. 함수의 실제 주소가 다르면 `--api-url FUNCTION_BASE_URL`을 지정합니다. 주소 끝에 `/api`는 붙이지 않습니다.

생성되는 파일:

- `.env.production.local`: Vite의 공개 Firebase 설정, `VITE_CLOUD_MODE=true`, API 주소. 본인 이메일은 공개 빌드에 넣지 않습니다.
- `functions/.env.PROJECT_ID`: 서버의 본인 이메일, Netlify origin, API 기본 주소, 프로젝트·버킷·리전, 선택 기능 사용 여부.
- `.cloud-local/storage-cors.json`: 이 Netlify origin만 허용하는 버킷 CORS 설정.

기존 파일이 있으면 명령이 중단되며 기존 내용은 보존합니다. 주소 등을 바꿀 때는 필요한 변수만 직접 수정합니다. 로컬 설정과 비밀값을 Git에 커밋하지 않습니다. 스크립트는 외부 서비스 생성·배포·권한 변경을 실행하지 않습니다.

Netlify가 GitHub에서 자동 빌드할 경우 `.env.production.local`은 전달되지 않습니다. 이 파일의 `VITE_*` 설정을 Netlify의 환경 변수로 등록하고 다시 빌드하세요. `VITE_*` 값은 브라우저에 포함되므로 AI 키·OAuth 비밀값·암호화 키를 넣으면 안 됩니다. 유료 방식을 선택하면 Netlify 설정의 `VITE_DEPLOYMENT_MODE`도 `paid`로 변경합니다. 무료용 Netlify Functions는 유료 방식에서는 사용하지 않으며 API는 `VITE_API_ORIGIN`의 Firebase 함수로 직접 요청합니다.

## 실행 계정과 원본 파일 권한

배포에 사용하는 Firebase/Google Cloud 계정은 본인이 CLI로 인증합니다. GitHub 저장소 인증만으로 Firebase 또는 Netlify 접근 권한이 생기지 않습니다. Functions는 플랫폼의 실행 서비스 계정을 사용하며 다운로드한 서비스 계정 키를 요구하지 않습니다.

배포 명령을 실행하는 머신에는 [Firebase CLI](https://firebase.google.com/docs/cli#install_the_firebase_cli)와 [Google Cloud CLI](https://cloud.google.com/sdk/docs/install)가 필요합니다. 각 도구의 공식 설치 안내를 따라 설치하고 `firebase login`, `gcloud auth login`으로 본인 계정에 로그인합니다. 서비스 계정 비밀 키를 채팅으로 전달하지 않습니다. 클라우드 환경 밖에서 실행하면 아래 `/workspace/me`와 npm 캐시 경로를 본인의 저장소·캐시 경로로 조정합니다.

기본 실행 계정은 `PROJECT_NUMBER-compute@developer.gserviceaccount.com`입니다. 실제 사용 중인 실행 계정은 배포된 함수 설정에서 확인하세요. 전용 서비스 계정을 선택하면 helper의 `--service-account EMAIL` 또는 `APP_FUNCTION_SERVICE_ACCOUNT`로 지정합니다. Firebase CLI에서 예약한 `FIREBASE_*` 변수 이름을 자체 Functions `.env`에 넣지 않습니다. 앱 변수는 `APP_FIREBASE_PROJECT_ID`, `APP_STORAGE_BUCKET`, `APP_FUNCTION_REGION`을 사용합니다.

Cloud Storage의 서명 URL을 발급하려면 IAM Service Account Credentials API와 실행 계정의 `iam.serviceAccounts.signBlob` 권한이 필요합니다. 다음 명령은 **실행 계정 자신에 대해서만** Token Creator를 부여합니다. 프로젝트 전체에 Token Creator 역할을 주지 않습니다. 새 전용 프로젝트에서 실제 프로젝트 ID·실행 계정·버킷을 확인한 뒤 실행합니다.

```sh
gcloud services enable iamcredentials.googleapis.com --project "$PROJECT_ID"
gcloud iam service-accounts add-iam-policy-binding "$RUNTIME_SERVICE_ACCOUNT" \
  --project "$PROJECT_ID" \
  --member="serviceAccount:$RUNTIME_SERVICE_ACCOUNT" \
  --role=roles/iam.serviceAccountTokenCreator
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:$RUNTIME_SERVICE_ACCOUNT" \
  --role=roles/datastore.user
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:$RUNTIME_SERVICE_ACCOUNT" \
  --role=roles/firebaseauth.viewer
gcloud storage buckets add-iam-policy-binding "gs://$BUCKET_NAME" \
  --member="serviceAccount:$RUNTIME_SERVICE_ACCOUNT" \
  --role=roles/storage.objectAdmin
gcloud storage buckets update "gs://$BUCKET_NAME" \
  --cors-file=.cloud-local/storage-cors.json
```

이미 필요한 권한이 있는 경우 중복 변경할 필요가 없습니다. Firestore와 Firebase Auth 조회 권한은 앱 전용 프로젝트에, 원본 파일 권한과 CORS는 앱 전용 버킷에 적용합니다. Auth 조회는 토큰의 폐기 여부까지 확인하는 데 사용합니다. CORS는 보안 규칙이나 사용자 인증을 대신하지 않습니다. 사이트 주소가 바뀌면 서버 `APP_URL`, Vite 설정, Firebase 승인된 도메인과 버킷 CORS를 함께 갱신합니다.

## 선택 기능: AI 분석과 Drive 백업

처음에는 두 기능을 꺼둔 채 로그인·경력 등록·공문 보관을 확인할 수 있습니다. AI를 켜려면 helper의 `--ai` 또는 Functions `.env`의 `APP_AI_ENABLED=true`를 사용하고 `APP_AI_KEY`를 Firebase Secret Manager에 설정합니다. `APP_AI_MODEL`은 선택이며 기본 `gpt-4.1-mini`입니다. 문서와 이미지의 내용은 설정한 외부 AI 서비스로 전송됩니다.

```sh
firebase functions:secrets:set APP_AI_KEY --project "$PROJECT_ID"
```

Drive 백업은 Firebase 로그인과 별개의 OAuth 연결입니다. Google Cloud에서 Drive API를 활성화하고 OAuth 동의 화면과 웹 애플리케이션 OAuth 클라이언트를 설정합니다. 승인된 리디렉션 URI는 **`APP_API_URL` + `/api/auth/callback`** 입니다. Netlify 사이트의 `/api/auth/callback` 주소로 등록하지 마세요. OAuth 테스트 상태라면 본인 계정을 테스트 사용자에 추가합니다.

helper에서 `--drive --google-client-id OAUTH_CLIENT_ID`를 사용하거나 Functions `.env`에 `APP_DRIVE_ENABLED=true`, `GOOGLE_CLIENT_ID`를 설정합니다. 비밀값 두 가지는 Firebase Secret Manager에 입력합니다.

```sh
firebase functions:secrets:set GOOGLE_CLIENT_SECRET --project "$PROJECT_ID"
openssl rand -base64 32 | firebase functions:secrets:set APP_ENCRYPTION_KEY \
  --project "$PROJECT_ID" --data-file -
```

`APP_ENCRYPTION_KEY`는 저장된 Drive 토큰의 암호화에 쓰입니다. 키를 바꾸면 Drive를 다시 연결해야 합니다. 키와 OAuth 비밀값을 채팅·로그·웹 설정에 복사하지 않습니다. 사용 설정된 기능의 비밀값만 함수에 연결합니다. Drive 기능을 켜면 `careerBackup` 예약 함수가 날짜별 백업을 실행하며 Cloud Scheduler도 사용합니다. 백업은 앱이 만든 파일에 대한 `drive.file` 권한을 사용합니다. 실제 연결·백업 성공 여부는 앱의 백업 및 설정 화면에서 확인합니다.

## 배포와 확인

```sh
cd /workspace/me
npm run build
npm run build:functions
npm test
```

`npm run build:functions`는 서버 공통 코드를 `functions/lib/index.mjs`에 묶습니다. Node.js 22 Functions 런타임을 대상으로 하며 Firestore·Storage SDK 등은 `functions/package-lock.json`으로 고정한 의존성을 설치합니다. Firebase predeploy가 이 빌드와 `npm --prefix functions ci`를 다시 수행합니다. 개발용 SQLite 디렉터리를 배포하지 않습니다. PDF 추출은 Functions에서 PDF.js를 사용하므로 Poppler 설치에 의존하지 않습니다.

**새 앱 전용 프로젝트**임을 확인한 경우에만 제공된 전체 보안 규칙을 게시합니다. 아래 규칙은 브라우저의 직접 접근을 모두 차단합니다. API 실행 계정은 IAM으로 접근합니다.

```sh
firebase deploy --project "$PROJECT_ID" --only firestore:rules,storage
firebase deploy --project "$PROJECT_ID" --only functions:career-app:careerApi
```

Drive가 켜져 있으면 예약 함수도 배포합니다.

```sh
firebase deploy --project "$PROJECT_ID" --only functions:career-app:careerApi,functions:career-app:careerBackup
```

기존 Firebase 프로젝트를 재사용할 때는 위 보안 규칙 전체를 곧바로 배포하지 마세요. 현재 Firestore/Storage 규칙, 배포된 함수명과 버킷 CORS를 먼저 읽고 다른 앱의 정책을 보존하며 병합해야 합니다. 이 앱의 Firestore 경로는 `careerArchives/{uid}`, Storage 경로는 `careerArchives/users/{uid}`입니다. 보안 규칙은 여러 match 중 하나가 허용하면 접근 가능하므로 넓은 기존 허용 규칙이 이 경로까지 허용하는지도 확인해야 합니다. `careerApi`·`careerBackup` 함수명이 이미 다른 앱에서 쓰이는 경우 그 함수도 덮어쓰지 않습니다.

Netlify CLI로 본인 계정에 로그인하고 **이 앱의 사이트 ID**를 선택한 뒤 로컬 `dist`를 배포합니다. 기존 다른 사이트를 덮어쓰지 않도록 사이트 ID를 먼저 확인합니다.

```sh
npx netlify-cli login
npx netlify-cli deploy --dir=dist --site="$NETLIFY_SITE_ID" --prod
```

이 저장소에서는 GitHub 커밋·푸시나 실제 서비스 배포를 자동으로 실행하지 않습니다. GitHub 자동 배포 연결을 선택하면 변경 사항을 검토한 뒤 본인의 절차로 반영합니다. Netlify의 임시 배포 미리보기 주소는 설정한 `APP_URL`과 다르므로 인증·CORS 확인에는 고정된 실제 사이트 주소를 사용합니다.

배포한 실제 HTTPS 사이트에서 다음을 확인합니다.

1. 본인 구글 계정으로 로그인하고 다른 계정의 API 접근이 거절되는지 확인.
2. 경력 하나를 등록하고 새로고침·다른 컴퓨터 로그인 뒤에도 남아 있는지 확인.
3. 공문 업로드·연결·원본 다운로드와 중복 검사 확인.
4. 이력서/증빙 ZIP, 전체 백업 다운로드와 테스트 데이터를 이용한 복원 확인.
5. AI 사용 시 분석 결과를 확인하고, Drive 연결 후 수동 백업 성공 시각과 Drive의 실제 파일을 확인.

새 Firebase 경력 보관함은 빈 상태로 시작합니다. 기존 PDF에서 정리한 65개 후보는 개인 데이터이므로 GitHub, Netlify 빌드 산출물, Functions 번들에 넣지 않습니다. 기존 개발 환경에서 만든 `.cloud-local/initial-career-backup.zip`을 본인 컴퓨터로 내려받고, 로그인 후 백업 및 설정 → 복원에서 가져옵니다. 기존 공문 원본은 이 초기 후보와 별개이며 직접 업로드해야 합니다. 복원은 현재 경력과 공문 전체를 교체하므로 빈 보관함에서 먼저 가져오거나 기존 데이터를 백업한 뒤 진행합니다.

실제 클라우드 로그인·IAM·Storage 서명·Drive·AI는 이 확인을 마치기 전에는 검증 완료로 표시하지 않습니다. 서버 로그에 토큰·공문 내용·비밀값을 출력하지 않습니다. 사용자별 데이터와 원본은 Firebase에 남고 Functions의 임시 파일 시스템에는 지속 저장하지 않습니다.

현재 원본과 다운로드용 `careerArchives/users/{uid}/exports/` ZIP에는 자동 삭제 수명 정책을 설정하지 않습니다. 서명 URL의 만료는 저장된 파일의 삭제를 뜻하지 않습니다. 저장량을 관리할 때는 다운로드용 ZIP 경로만 대상으로 정리 정책을 검토하고 원본까지 지우는 버킷 전체 정책을 적용하지 않습니다.

Netlify의 CSP는 기본 `*.firebaseapp.com`/`*.web.app` 인증 도메인과 Google API, 기본 Functions/Cloud Run 주소를 허용합니다. 인증 도메인 또는 API를 사용자 도메인으로 바꿀 경우 해당 주소만 CSP의 `frame-src`/`connect-src`에 추가해야 합니다. 외부 주소 전체를 허용하는 방식으로 문제를 우회하지 않습니다.
