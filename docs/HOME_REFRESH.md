# 나의 기록실 홈 화면

작업 전 기준: `f2506dd1efbe95bef661ae1cb85116065626048c`. `backup/before-home-refresh-20261017` 브랜치에 보존했습니다.

## 화면

- 표시 이름과 브라우저 제목을 `나의 기록실`로 바꿨습니다. 기존 계정, 데이터 키, JSON 형식 이름, 백업 파일명과 Drive 폴더를 식별하는 값은 그대로입니다.
- `/`는 새 홈입니다. 기존 대분류 이력, 수업, 강의 자료, 대학원은 그대로이며 왼쪽 홈 버튼이나 브랜드를 눌러 돌아옵니다. `#careers` 같은 주소로 화면을 직접 열 수 있고 새로고침해도 현재 탭이 열립니다.
- 홈 바로가기의 건수는 현재 계정의 저장 데이터로 계산합니다. 수업에는 수업 기록과 학급 자료가 포함됩니다.
- 일정과 마감은 날짜가 정확히 입력된 오늘 이후 이력, 미제출 과제를 보여 줍니다. 기한이 지난 과제는 표시하고 제출 완료 과제는 제외합니다. 연도나 월만 있는 이력을 임의의 일정으로 만들지 않습니다.
- 최근 작업은 수업, 자료, 논문 노트, 주제 메모의 수정일 순입니다. 최근 활동은 활동 시작일 순입니다. 누르면 원래 상세 화면으로 이동합니다.
- 성장 지도와 연도별 차트는 이력 탭에 유지합니다. 분야 비율 원형 차트와 퍼센트는 없애고 클릭 가능한 분야별 건수만 표시합니다.
- 본문과 메뉴에 Pretendard Variable 공식 파일을 포함하고 큰 제목에는 Paperlogy를 유지합니다. [폰트 출처와 라이선스](FONT_RESEARCH.md)를 참고하세요.
- 모드 선택은 상단에 고정하고 백업 및 설정에도 추가했습니다. 같은 브라우저에서 선택 상태를 공유합니다.

## 네이버 캘린더 조사

요청한 기능은 양방향 자동 동기화입니다. 확인한 네이버 공식 공개 자료에는 `POST /calendar/createSchedule.json` 일정 추가 API가 있습니다. 공개 명세와 가이드에서 일정 목록 조회, 변경, 삭제, 변경 알림 API는 확인되지 않았습니다. 따라서 이 자료만으로 양방향 연동을 구현했다고 표시하지 않습니다.

- [네이버 공식 캘린더 일정 추가 API 가이드](https://github.com/naver/naver-openapi-guide/blob/master/ko/login/calendar-api/calendar-api.md)
- [네이버 공식 OpenAPI 명세](https://github.com/naver/naver-openapi-guide/blob/master/naver-openapi-swagger.json)

개발자 사이트와 도움말 사이트는 실행 환경에서 접속이 제한되어 네이버 소유의 공식 GitHub 문서를 확인했습니다. CalDAV 같은 별도 동기화 경로의 현재 지원 여부, 인증 방식과 웹 서비스에서의 이용 가능성은 확인되지 않았습니다. 이를 확인하기 전에는 전체 양방향 지원 여부를 단정할 수 없습니다. 일회성 일정 추가나 ICS 가져오기는 요청한 양방향 자동 동기화와 동일하지 않습니다.

홈의 `네이버 캘린더 열기`는 새 탭에서 캘린더 웹사이트를 여는 링크입니다. 계정 연결이나 데이터 전송을 하지 않습니다. 앱에 입력된 일정만 홈에 표시하며 네이버 일정은 동기화되지 않는다고 명시했습니다.

## 배포 확인

직전 변경 `f2506dd`는 GitHub main에 있지만 배포 사이트는 이 환경에서 HTTP 401을 반환했고 GitHub의 해당 커밋 체크 목록에도 배포 결과가 없었습니다. 이 사실만으로 Netlify 배포 실패나 캐시 문제라고 단정할 수 없습니다.

백업 및 설정에 빌드한 커밋의 앞 7자리 `화면 버전`을 표시합니다. Netlify에서는 `COMMIT_REF`, 로컬에서는 Git HEAD를 사용합니다. `/`에도 HTML 캐시 재검증 헤더를 추가했습니다. Netlify의 실제 Published 커밋과 사용하는 앱 URL을 대조해야 버튼 미표시의 원인을 확인할 수 있습니다.

## 바뀐 파일과 검증

- 홈: `src/home/HomeDashboard.tsx`, `home-model.ts`, `home.css`.
- 화면 연결과 이름: `src/App.tsx`, `WorkspaceTree.tsx`, `types.ts`, `main.tsx`, `index.html`.
- 테마와 버전: `src/ThemeControl.tsx`, `BackupSettings.tsx`, `theme.css`, `env.d.ts`, `vite.config.ts`, `netlify.toml`.
- 폰트와 분야 건수: `src/styles.css`, `refinements.css`, `studio.css`, `growth/GrowthOverview.tsx`, `public/fonts/Pretendard*`.
- 검사: `test/home-model.test.mjs`, `home-e2e.spec.ts`, 기존 테마, 이력, 성장, 화면 구성 검사의 진입 주소, `playwright.config.ts`.

빌드와 홈 및 성장 집계 단위 검사 5개, 데스크톱 브라우저 시나리오 6개가 통과했습니다. 마지막 보완 후 홈 시나리오도 다시 통과했습니다. 홈 이동, 글꼴 로딩, 과제와 자료 열기, 테마 선택, 이력 CRUD, 업로드, 증빙, HWPX와 ZIP 백업 복원을 확인했습니다. 휴대폰과 태블릿 검사는 실행하지 않았습니다. 서버 저장 구조와 실제 계정 데이터에는 변경이 없습니다.

## 되돌리기

이번 변경 커밋을 `git revert <홈 개선 커밋>`으로 되돌리고 `git push origin HEAD:main` 하면 이전 화면으로 돌아갑니다. 데이터 복원이나 마이그레이션은 필요 없습니다.
