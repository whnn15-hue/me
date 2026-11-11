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

## 구글 드라이브 → OneDrive 이전 대상

2026-11-11 사용자가 **기존 원본을 모두 옮기기**로 결정했습니다. 파일 ID가 저장되는 곳을 전부 확인한 결과입니다.

| 위치 | 필드 | 이전 처리 |
|---|---|---|
| Firestore 활성 버전 `documents/{id}` | `driveFileId` | **옮김.** 공문, 사진·제출본 원본, 수업·강의 자료 원본(`file-<sha>` 기록), 증빙 묶음 원본이 모두 여기에 있습니다. |
| 사진(`photo.documentId`), 제출본(`submission.documentIds`) | 기록 ID | 공문 기록을 가리키므로 따라옵니다. |
| 자료(`material.fileUrl`) | 구글 드라이브 보기 링크 | 링크는 그대로 둡니다(구글 원본을 지우지 않으므로 계속 열림). 앱 안 오디오·HTML 미리보기는 같은 SHA-256의 공문 기록을 통해 OneDrive 원본을 읽습니다(`src/free/material-preview.ts`). |
| 이력서 양식(`template`) | 요청마다 새로 올림 | 저장된 ID가 없어 옮길 것이 없습니다. |
| 날짜별 백업·전체 백업 ZIP·증빙 묶음 출력(`backup`/`export`/`output`) | 서버 보관함 `lastBackup` 등 | 옮기지 않습니다. 전환 뒤 새 백업은 OneDrive에 쌓이고 예전 백업은 구글 드라이브에 남습니다. |

## 이전 방식 (구현됨)

서버가 파일을 복사하고, 브라우저가 기록을 바꿉니다. Firestore 보안 규칙상 기록 변경은 본인 로그인으로 `revision`을 1 올리는 트랜잭션에서만 가능하기 때문입니다.

1. 구글 드라이브가 활성(`APP_STORAGE_PROVIDER` 없음 또는 `google`)이고 `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`이 있으면 설정 화면에 **OneDrive로 옮기기** 카드가 보입니다. 미리보기 빌드에서는 보이지 않습니다.
2. **OneDrive 연결**: `POST /api/migration/onedrive/start` → 마이크로소프트 로그인 → `GET /api/auth/onedrive/callback`. 이 연결은 이전용이며 구글 드라이브 연결과 백업은 그대로 동작합니다.
3. **옮기기 시작**: 브라우저가 `POST /api/migration/onedrive/step`을 반복합니다. 한 번에 약 25초 동안 새 파일을 시작하고(요청 제한 55초), 파일마다
   구글 원본 읽기(크기·SHA-256 확인) → OneDrive 앱 폴더에 업로드 → OneDrive에서 다시 읽어 크기·SHA-256 확인 순서로 진행합니다.
4. 진행 기록은 암호화 보관함 `migration/onedrive/{uid}`에 남습니다(구글 ID → OneDrive ID, 상태, 실패 사유). 파일 내용은 저장하지 않습니다.
   - 업로드 도중 멈췄으면 다음 단계에서 앱 폴더를 SHA-256으로 찾아 **다시 올리지 않습니다.**
   - 업로드는 끝났지만 확인 전이면 확인만 다시 합니다.
   - 같은 소유자의 두 번째 탭은 잠금(`migration/{uid}`) 때문에 동시에 실행되지 않습니다.
5. 각 단계 응답의 `mapping`(확인을 마친 구글 ID → OneDrive ID)을 브라우저가 `applyFreeStorageMigration`으로 **한 트랜잭션**에 반영합니다. 기록이 그사이 바뀌었으면(다른 원본, 다른 SHA-256) 건드리지 않습니다. 탭을 닫아 반영하지 못해도 다음 단계가 같은 매핑을 다시 알려 줍니다.
6. 실패한 원본(무결성 불일치, 구글 원본 없음 등)은 구글 ID 그대로 두고 화면에 사유를 보여 줍니다. **실패한 원본 다시 시도**로 재시도합니다.
7. 모두 끝나면 카드가 다음 단계를 안내합니다. 구글 드라이브 원본은 지우지 않습니다.
8. `APP_STORAGE_PROVIDER=onedrive`로 바꾼 뒤에는 이전 경로가 `{ switched: true }`만 돌려주고 아무것도 하지 않습니다.

### 소유자 실행 순서

1. Vercel 정식 사이트에서 로그인 → 백업 및 설정 → **전체 백업 ZIP 받기**.
2. **OneDrive 연결** → 마이크로소프트 개인 계정으로 동의.
3. **옮기기 시작** → 진행 막대가 끝날 때까지 탭을 열어 둡니다. 닫았다면 다시 눌러 이어서 합니다.
4. 실패가 있으면 사유를 확인하고 **다시 시도**. 계속 실패하는 원본은 개별 확인이 필요합니다.
5. "모든 원본을 옮겼습니다"가 나오면 Vercel 환경 변수 `APP_STORAGE_PROVIDER=onedrive`(Production)를 추가하고 다시 배포합니다.
6. 설정에서 OneDrive를 연결하고, 공문 하나를 열어 보고, 수동 백업을 한 번 실행해 확인합니다.

이전은 Vercel(함수 최대 60초)에서 실행합니다. Netlify의 동기 함수 제한(약 26초)에서는 큰 파일이 시간 안에 끝나지 않을 수 있습니다.

## 롤백

`APP_STORAGE_PROVIDER`를 지우거나 `google`로 바꾸고 다시 배포하면 구글 드라이브로 돌아갑니다. 구글 연결 정보는 지우지 않았으므로 다시 연결할 필요가 없습니다. 단, 전환 뒤 OneDrive에만 올린 원본은 구글 모드에서 열 수 없으니 되돌리기 전에 전체 백업 ZIP을 받아 둡니다.

## 실제 계정 연결 시험 (2026-11-11)

사용자 개인 계정으로 기기 코드 로그인을 해서, 등록한 앱 `이력보관함 OneDrive`로 다음을 확인했습니다. 앱 코드가 아니라 같은 Graph 요청을 보내는 시험 스크립트로 한 것입니다.

- 동의 후 받은 권한: `openid profile User.Read Files.ReadWrite.AppFolder`. 개인 계정이라 관리자 승인이 필요 없습니다.
- 첫 요청 때 OneDrive에 `Apps/이력보관함 OneDrive` 앱 폴더가 생깁니다. 생성 직후의 경로 기반 업로드 한 번은 404였고, 폴더 ID로 올리는 앱 방식은 정상이었습니다.
- 업로드 201, 서버 방식(`/content` 리디렉션을 Node fetch로 따라가기) 200 내용 일치, 브라우저 방식(`@microsoft.graph.downloadUrl`, 인증 헤더 없이) 200 내용 일치, 용량 조회 200, 삭제 204. 시험 파일은 모두 지웠습니다.
- 다운로드 주소 호스트는 `my.microsoftpersonalcontent.com`이며 CSP의 `https://*.microsoftpersonalcontent.com`에 포함됩니다.
- 새 항목 ID 형식은 `16자리 16진수!s32자리 16진수`입니다. `shared/storage-id.mjs`가 허용하며 테스트에 넣었습니다.
- 실제 앱 화면을 통한 연결, 웹 리디렉션 방식 로그인, CORS 업로드는 Vercel 배포 뒤에 확인해야 합니다.

## 시험 범위

`test/onedrive.test.mjs`는 가짜 보관함과 모의 Graph 응답만 씁니다. PKCE 인가·토큰 교환, 소유자 확인, 재사용 state 거부, 앱 폴더 권한 누락 거부, 다른 마이크로소프트 계정 재연결 거부, 토큰 갱신·교체, 작은/큰(3조각) 업로드, 무결성 검증 읽기, 상태, 연결 해제, 예약 백업 성공/실패를 확인합니다. 실제 마이크로소프트 계정 연결과 실제 CORS/CSP 동작은 아직 확인하지 않았습니다.
