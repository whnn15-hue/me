# 자동 배포와 완료 확인

사용자는 매번 수동 배포하지 않도록 앱 변경 후 자동 배포를 요청했습니다. 기본 경로는 기존 GitHub 저장소의 main을 Netlify가 감지해 빌드하고 게시하는 방식입니다. 이 경로에는 별도의 GitHub Actions 파일이 필요하지 않습니다.

## 현재 대상

- GitHub: `whnn15-hue/me`, `main`.
- Netlify 프로젝트: `sensational-cuchufli-e3fbc9`.
- 사이트 ID: `f5cf3147-38fc-4cb3-9505-982fbc72c328`.
- 배포 목록: https://app.netlify.com/sites/sensational-cuchufli-e3fbc9/deploys
- 배포 설정: https://app.netlify.com/sites/sensational-cuchufli-e3fbc9/configuration/deploys

## 네이티브 자동 배포 복구

Netlify 관리 화면에 인증된 접근이 있을 때 실제 설정을 먼저 확인합니다.

1. Project configuration → Build & deploy → Continuous deployment에서 연결된 저장소가 `whnn15-hue/me`인지 확인합니다.
2. Production branch는 `main`, 빌드 상태는 활성 상태여야 합니다. `Stopped builds` 상태이면 빌드를 재개합니다.
3. 빌드 명령은 `npm run build`, Publish directory는 `dist`입니다. 저장소 루트의 `netlify.toml`을 사용합니다. 별도 패키지 폴더를 Base directory로 지정하지 않습니다.
4. Functions 디렉터리는 `netlify/functions`입니다. 현재 서버 환경 변수와 로그인, Drive 연결 정보를 유지합니다.
5. 배포 목록에서 특정 배포로 잠가 놓은 상태인지 확인합니다. 자동 게시가 잠겨 있으면 빌드는 성공해도 이전 화면이 계속 표시될 수 있습니다. 사용자 요청에 따라 이 앱의 자동 게시를 재개합니다.
6. 설정 복구 후 현재 main을 한 번 배포합니다. 이후 main 푸시로 자동 실행되는지 확인합니다.

실패 원인은 실제 로그로 판단합니다. 새 배포가 아예 없는 경우는 저장소 연결, 브랜치, 중단된 빌드 등을 확인하고, 실패한 배포가 있는 경우 해당 로그부터 확인합니다. 사용량 제한이 표시되면 무료 사용 원칙을 유지하며 결제나 요금제를 임의로 변경하지 않습니다.

## 완료 기준

- 검사와 빌드가 성공했습니다.
- 예상한 커밋이 원격 main에 있습니다.
- Netlify 프로덕션 배포가 같은 커밋으로 Published 상태입니다.
- 앱의 백업 및 설정 → 화면 설정 → 화면 버전이 같은 커밋 앞 7자리를 표시합니다.
- 로그인 및 API 접근이 가능한 인증된 환경에서 변경 화면을 확인합니다.

사이트가 Netlify 계정 인증을 요구하면 이 앱의 Firebase 로그인보다 앞에서 접근이 차단됩니다. 검증 편의를 위해 해당 보호를 해제하지 않습니다. 코드 푸시만 확인한 경우에는 그렇게 명시하고 배포 완료라고 표현하지 않습니다.

## 2026-10-17 진단

홈 및 폰트 개선 커밋 `208f946`이 GitHub main에 있는 것은 확인했습니다. 사이트와 `/api/status`의 HTTP 401 본문은 Netlify `edge-access` 인증 화면으로 이동시키는 내용이었습니다. GitHub의 해당 커밋 체크 화면에는 체크가 없었으나 이것만으로 Netlify 자동 배포 연결 유무를 단정할 수는 없습니다.

현재 작업 환경에는 Netlify CLI 인증 파일, Netlify 접근 토큰, Build hook이 없으며 Netlify 관리 API와 GitHub 관리 API에 대한 요청도 접근 제한으로 실패했습니다. 사용자의 배포 허락이 없는 것이 아니라 배포 관리 상태를 읽고 변경할 연결이 없는 상황입니다. 최신 Published 커밋과 배포 상태를 요청한 상태이며, 원인은 해당 정보나 인증된 Netlify 연결로 확인해야 합니다.

로컬에서 Netlify 공식 패키저 `@netlify/zip-it-and-ship-it` 16.3.0으로 같은 함수 디렉터리와 외부 의존성, 포함 파일 설정을 적용해 두 함수의 ZIP을 생성했습니다. `career-api`, `career-backup` 모두 성공했고 예약 백업 스케줄도 매니페스트에 포함되었습니다. 검사 패키지와 결과물은 `/tmp`에만 저장했으며 앱 의존성을 바꾸지 않았습니다. 이 검사는 Netlify 관리 서버의 실제 배포 성공을 대신하지 않습니다.
