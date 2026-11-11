# OneDrive 개인 계정 저장소

공문 원본, 수업 자료, 날짜별 백업을 구글 드라이브 대신 **Microsoft OneDrive 개인 계정**에 보관하는 선택 기능입니다. 서버 환경 변수 `APP_STORAGE_PROVIDER=onedrive`일 때만 켜지며, 기본값은 지금과 같은 구글 드라이브(`google`)입니다. 로그인과 경력 데이터(Firebase)는 바뀌지 않습니다.

## 동작 방식

- 인증: Microsoft identity platform v2, `https://login.microsoftonline.com/consumers` (개인 계정 전용). 인가 코드 + PKCE + 클라이언트 암호(웹 앱)입니다.
- 권한: `openid profile offline_access User.Read Files.ReadWrite.AppFolder`. 앱은 OneDrive의 **앱 폴더**(`앱/<등록한 앱 이름>`)만 읽고 쓸 수 있습니다. 다른 OneDrive 파일에는 접근하지 않습니다. 구글의 `drive.file` 권한과 같은 범위입니다.
- 토큰: 마이크로소프트 refresh token은 서버의 암호화 보관함(`oneDriveTokens/{uid}`)에만 저장합니다. 브라우저에는 앱 폴더용 짧은 access token만 전달합니다. 마이크로소프트는 refresh token을 갱신 때마다 바꾸므로 항상 새 값으로 교체합니다.
- 계정 묶기: 앱 로그인(구글, `OWNER_EMAIL`)은 지금과 같습니다. OneDrive 계정의 이메일은 달라도 되고 설정 화면에 표시만 합니다. 처음 연결한 마이크로소프트 계정과 다른 계정으로 다시 연결하는 것은 막습니다. 기존 파일 ID를 다른 계정에서 찾을 수 없기 때문입니다.
- 파일: 모든 파일을 앱 폴더 바로 아래에 둡니다. 구글 드라이브의 `나의 경력 보관함` 폴더 하나에 모으던 방식과 같습니다. 같은 이름이면 OneDrive가 자동으로 이름을 바꿉니다. `" * : < > ? / \ |` 문자는 `_`로 바꿉니다.
- 파일 정보: 구글의 `appProperties` 대신 OneDrive 항목 **설명(description)**에 `{"v":1,"archiveUid","kind","sha256"}`를 저장합니다. 읽을 때 보관함 UID, 종류, 앱 폴더 위치, SHA-256을 확인합니다. 설명 필드는 OneDrive 개인 계정에만 있어서 회사/학교 계정은 지원하지 않습니다.
- 업로드: 모든 크기의 파일을 업로드 세션(`createUploadSession`)으로 올립니다. 설명이 내용과 함께 한 번에 저장되기 때문입니다. 서버는 10MiB, 브라우저는 5MiB 조각으로 보냅니다. 업로드 주소에는 토큰을 보내지 않습니다.
- 다운로드: 서버는 `/content`(사전 인증 주소로 리디렉션), 브라우저는 항목의 `@microsoft.graph.downloadUrl`을 사용합니다.
- 삭제: OneDrive 휴지통으로 이동합니다.
- 연결 해제: 마이크로소프트 개인 계정에는 토큰별 폐기 API가 없어 서버에서 토큰만 지웁니다. 권한을 완전히 없애려면 https://account.live.com/consent/Manage 에서 앱을 제거합니다.

## Azure 앱 등록

**2026-11-11 등록 완료 (일부):** 사용자의 개인 마이크로소프트 계정 디렉터리("기본 디렉터리")에 앱 `이력보관함 OneDrive`를 만들었습니다.

- 애플리케이션(클라이언트) ID: `ea01775f-4639-42c4-a243-7bbe1851f682` (공개 식별자)
- 계정 유형: 개인 Microsoft 계정만 (`PersonalMicrosoftAccount`), access token v2
- API 권한: Microsoft Graph 위임 `Files.ReadWrite.AppFolder`, `User.Read`, `offline_access`, `openid`, `profile`
- 퍼블릭 클라이언트 흐름: **연결 시험용으로 켜 둠**. 실제 운영 전환 때 끄면 됩니다.
- **아직 남은 것:** Vercel 주소가 정해진 뒤 웹 리디렉션 URI(`https://<주소>/api/auth/onedrive/callback`)를 추가하고, 클라이언트 암호를 사용자가 직접 만들어 Vercel 환경 변수에만 넣습니다. 앱 폴더 이름은 OneDrive에서 `앱/이력보관함 OneDrive`로 보입니다.

처음부터 새로 등록할 때의 절차는 아래와 같습니다.

1. https://portal.azure.com 에서 본인 디렉터리를 가진 마이크로소프트 계정으로 **앱 등록 → 새 등록**.
   - 지원되는 계정 유형: **개인 Microsoft 계정만**
   - 리디렉션 URI: 플랫폼 **웹**, `https://<실제 사이트 주소>/api/auth/onedrive/callback`
2. **인증서 및 암호 → 새 클라이언트 암호**를 만들고 값을 Vercel 환경 변수에만 넣습니다. 채팅, Git, 문서에 붙여 넣지 않습니다. 만료일이 지나기 전에 새 암호로 교체합니다.
3. **API 권한**에 Microsoft Graph 위임 권한 `Files.ReadWrite.AppFolder`, `User.Read`, `offline_access`, `openid`, `profile`을 추가합니다. 개인 계정은 첫 연결 때 본인이 동의합니다.

미리보기 주소를 따로 쓰는 경우에도 실제 OneDrive에 연결하지 않습니다. 미리보기는 지금처럼 가짜 데이터만 사용합니다.

## 서버 환경 변수

| 이름 | 값 |
|---|---|
| `APP_STORAGE_PROVIDER` | `onedrive` (없거나 다른 값이면 구글 드라이브) |
| `APP_DRIVE_ENABLED` | `true` |
| `MICROSOFT_CLIENT_ID` | 앱 등록의 애플리케이션(클라이언트) ID |
| `MICROSOFT_CLIENT_SECRET` | 클라이언트 암호 값 |
| `APP_URL`, `OWNER_EMAIL` | 지금과 같음 |

`GOOGLE_CLIENT_ID/SECRET`은 OneDrive 모드에서 사용하지 않습니다. 롤백을 위해 지우지 않고 둡니다.

## API 경로

- `POST /api/auth/drive/start`, `POST /api/auth/drive/access`, `POST /api/auth/drive/disconnect`: 이름은 그대로 두고 선택된 저장소에 연결합니다. `access` 응답에는 `provider: "onedrive"`가 붙습니다.
- `GET /api/auth/onedrive/callback`: 마이크로소프트 인증 완료 주소입니다. OneDrive 모드에서는 `/api/auth/callback`(구글)을 처리하지 않습니다.
- `GET /api/status`: `storageProvider`(`google`/`onedrive`)와 연결된 계정의 `storageAccount`를 함께 돌려줍니다.

## 브라우저 CSP에 필요한 주소

`connect-src`: `https://graph.microsoft.com`, `https://api.onedrive.com`(개인 계정 업로드 세션), `https://*.files.1drv.com`, `https://*.1drv.com`, `https://my.microsoftpersonalcontent.com`, `https://*.microsoftpersonalcontent.com`(다운로드/업로드 사전 인증 주소). 로그인은 전체 페이지 이동이라 `frame-src`는 필요 없고, `form-action`/리디렉션에는 `https://login.microsoftonline.com`이 쓰입니다. 실제 계정으로 첫 연결할 때 브라우저 콘솔에서 막힌 주소가 없는지 확인합니다.

## 기존 구글 드라이브 기록과의 호환

- 파일 ID 검사는 `shared/storage-id.mjs` 한 곳으로 모았습니다. 구글 ID(`[A-Za-z0-9_-]`)와 OneDrive 개인 ID(`0123456789ABCDEF!1234` 형식, `!`·`.` 포함)를 모두 허용합니다. 기존 기록, 백업 JSON/ZIP 복원은 그대로 읽힙니다.
- 별도 `storage` 필드는 추가하지 않았습니다. 기록 스키마와 백업 검증기를 바꾸지 않기 위해서입니다. 대신 활성 저장소가 OneDrive일 때 구글 ID로 된 원본을 열면 "구글 드라이브에 보관된 원본이면 OneDrive로 옮긴 뒤 다시 시도" 안내가 나옵니다. 이전이 끝나기 전에는 OneDrive 모드로 정식 전환하지 않습니다.
- 자료실의 "드라이브 링크" 입력(`shared/workspace.mjs`의 `driveOnly`)은 여전히 구글 드라이브/문서 공유 주소만 받습니다. OneDrive 공유 링크 허용은 별도 작업입니다.

## 구글 드라이브 → OneDrive 이전 대상 (이전 스크립트는 아직 없음)

이전 스크립트가 바꿔야 하는 값입니다.

- Firestore 활성 버전의 공문 기록 `documents[].driveFileId`: 각 원본을 OneDrive로 복사한 뒤 새 항목 ID로 교체합니다. `sha256`, `size`는 그대로 두고 복사 후 같은지 검증합니다. 사진·제출본·수업 자료는 `documentId`/`documentIds`로 공문 기록을 가리키므로 ID 교체만으로 따라옵니다.
- 서버 보관함의 `lastBackup`, `lastBackupKind`, `backupError`는 공통 키라 유지됩니다. 구글용 `driveTokens`, `driveFolder`, `driveConnectionVersion`은 롤백을 위해 남겨 둡니다.
- 구글 드라이브의 날짜별 백업 JSON/ZIP은 옮기지 않아도 됩니다. 필요하면 새 OneDrive 앱 폴더에 보관용으로만 복사합니다.
- 이전 전·후로 전체 백업 ZIP을 내려받아 두고, 이전은 한 번에 한 기록씩 CAS(`revision`)로 저장해 중간에 실패해도 섞이지 않게 합니다.

## 이전 방식 (결정 대기)

기존 원본을 모두 옮길지, 새 원본만 OneDrive에 저장할지는 사용자가 아직 정하지 않았습니다. 권장 방식은 **앱 안의 1회성 이전 도구**입니다.

1. 이전 전 전체 백업 ZIP을 내려받습니다.
2. 브라우저에서 구글 드라이브와 OneDrive 연결을 모두 연 상태로, 공문 기록마다 구글 원본을 받아 SHA-256을 확인하고 OneDrive 앱 폴더에 올린 뒤 다시 SHA-256을 확인합니다.
3. 같은 기록의 `driveFileId`를 새 ID로 바꿔 `revision` CAS로 저장합니다. 실패한 기록은 구글 ID를 그대로 두고 목록으로 보여 줍니다.
4. 모든 기록이 OneDrive ID가 되면 그때 `APP_STORAGE_PROVIDER=onedrive`로 정식 전환합니다. 구글 원본은 지우지 않습니다.

"새 원본만" 방식을 고르면 구글 ID 기록을 읽을 때 구글 드라이브로 대신 여는 이중 읽기가 필요합니다. 지금 코드는 한 번에 한 저장소만 쓰므로 그 경우 추가 작업이 필요합니다.

## 롤백

`APP_STORAGE_PROVIDER`를 지우거나 `google`로 바꾸고 다시 배포하면 구글 드라이브로 돌아갑니다. 구글 연결 정보는 지우지 않았으므로 다시 연결할 필요가 없습니다. 단, 전환 뒤 OneDrive에만 올린 원본은 구글 모드에서 열 수 없으니 되돌리기 전에 전체 백업 ZIP을 받아 둡니다.

## 시험 범위

`test/onedrive.test.mjs`는 가짜 보관함과 모의 Graph 응답만 씁니다. PKCE 인가·토큰 교환, 소유자 확인, 재사용 state 거부, 앱 폴더 권한 누락 거부, 다른 마이크로소프트 계정 재연결 거부, 토큰 갱신·교체, 작은/큰(3조각) 업로드, 무결성 검증 읽기, 상태, 연결 해제, 예약 백업 성공/실패를 확인합니다. 실제 마이크로소프트 계정 연결과 실제 CORS/CSP 동작은 아직 확인하지 않았습니다.
