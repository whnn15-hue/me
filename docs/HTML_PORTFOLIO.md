# HTML 자료와 포트폴리오 라이브러리

기존 이력, 수업, 강의 자료, 대학원 메뉴와 저장 방식을 유지하면서 수업과 자료 탐색을 개선했습니다. 새 라이브러리나 유료 서비스를 추가하지 않았습니다.

## 사용 방법

- 수업의 학급 자료나 강의 자료에 HTML 또는 HTM 파일을 끌어 놓거나 파일 선택으로 올립니다. 기존 공문 업로드도 HTML을 지원합니다. 파일당 25 MB, 한 번에 10개 제한은 같습니다.
- HTML 문서 제목, 설명, 작성자와 본문으로 자료 제목과 요약, 과목, 기초훈련을 자동 정리합니다. 파일명은 원본 정보에 보존합니다. 작성된 설명이 없는 항목은 본문을 이용하며 추론한 값은 수정할 수 있습니다.
- 자료 원본은 연결한 개인 드라이브에 저장하고 앱에는 기존 방식대로 링크와 메타데이터만 보관합니다.
- 앱에 직접 올린 HTML 자료는 상세 화면에서 미리 볼 수 있습니다. 2 MB 이하의 파일을 클릭했을 때만 읽습니다. 화면과 본문을 보여 주는 정적 미리보기이며, 스크립트, 외부 이미지, 외부 스타일과 입력 기능은 실행하지 않습니다. 전체 기능은 드라이브에서 원본을 내려받아 이용합니다. 별도 CSS, 이미지, JavaScript 파일을 참조하는 HTML은 그 파일들도 원래 폴더 구조로 보관해야 합니다.
- 갤러리와 목록을 전환하고 별표로 즐겨찾기에 모읍니다. 보기 방식은 현재 브라우저에 기억하고 즐겨찾기는 기존 계정 저장소와 백업에 저장합니다.
- 과목, 기초훈련, 대상, 형식, 태그와 검색을 함께 사용합니다. 자료의 파일 연결 여부를 필터링하고 카드에서 원본을 바로 열거나 수정합니다.

갤러리 표지는 파일 형식별 그래픽입니다. 문서의 실제 화면이나 사진 썸네일을 자동으로 가져오지 않습니다. 수업 사진도 기존처럼 사용자가 요청할 때만 불러옵니다. Notion, Behance, Are.na, Adobe Portfolio 참고 페이지는 실행 환경에서 접근이 제한되어 직접 열람하지 못했으며, 갤러리와 목록, 즐겨찾기, 필터를 사용하는 일반적인 포트폴리오 관리 패턴을 적용했습니다.

## 데이터 호환과 미리보기

`favorite`는 선택 필드입니다. 기존 행은 읽기만으로 필드가 추가되거나 다시 저장되지 않습니다. 즐겨찾기 저장에도 기존 버전 비교와 양방향 연결 유지 로직을 사용합니다. HTML 형식은 기존 자료 포맷과 공문 확장자 목록에 추가했습니다. 별도 마이그레이션이나 데이터베이스 초기화는 필요 없습니다. 전체 JSON, Drive 스냅샷, ZIP 백업의 검증기는 새 필드를 지원합니다.

미리보기는 기존 Drive 소유자, 보관 폴더, 파일 종류, 크기와 SHA-256 검사를 통과해야 합니다. HTML은 비활성 template에서 정리한 뒤 `sandbox=""` iframe에 넣습니다. 미리보기 전용 CSP는 스크립트, 외부 리소스와 네트워크 요청을 차단합니다. Netlify CSP에는 같은 출처의 프레임만 추가했고 스크립트 정책과 인증 정책은 유지했습니다. 서버 원본 다운로드는 첨부 파일로 전달합니다.

## 주요 파일

- `src/workspace/MaterialsView.tsx`, `ProjectsView.tsx`, `LibraryControls.tsx`: 갤러리와 목록, 즐겨찾기, 빠른 필터와 원본 열기.
- `src/portfolio-library.css`, `src/main.tsx`: 형식별 표지, 카드, 모바일 화면과 기존 이력의 시각적 정리.
- `shared/html.mjs`, `shared/html.d.mts`, `src/free/material-files.ts`, `server/extract.mjs`: HTML 판별, 인코딩과 메타데이터 추출.
- `src/workspace/HtmlPreview.tsx`, `html-preview.ts`, `src/free/material-preview.ts`, `netlify.toml`: 소유 파일 불러오기와 격리된 정적 미리보기.
- `shared/workspace.mjs`, `shared/material-classification.mjs`, `src/workspace/types.ts`: 선택적 즐겨찾기와 HTML 자료 포맷.
- `src/App.tsx`, `src/FileDropzone.tsx`, `src/free/drive.ts`, `normalize.ts`, `backup.ts`, `server/index.mjs`, `server/cloud/files.mjs`, `server/backup.mjs`: 파일 선택, 업로드, 기존 저장과 백업 호환.
- `test/html-preview-ui.test.mjs`, `material-preview.test.mjs`, `streamlined-data.test.mjs`, `free-backup.test.mjs`, `materials-ui.test.mjs`, `projects-ui.test.mjs`, `streamlined-e2e.spec.ts`: 원본 보존, 포맷과 미리보기, 즐겨찾기, 연결, 모바일, 회귀 검사.

## 검증

단위와 컴포넌트 검사 239개, 브라우저 시나리오 11개, 웹앱 빌드와 함수 빌드가 통과했습니다. 브라우저 검사에서 생성 ID를 잘못 가정한 검사 코드를 수정한 뒤 해당 시나리오를 다시 통과시켰습니다. HTML 원본의 ZIP 왕복, 잘못된 파일 거절, 소유 파일과 크기 검사, 실제 배포 CSP 아래 스크립트와 외부 요청 차단, 모바일 갤러리와 목록, 즐겨찾기 저장 후 연결 유지, 기존 이력과 백업 흐름을 확인했습니다. 브라우저 검사는 별도 임시 데이터베이스를 사용합니다. 실제 사용자 Firebase와 Drive에는 검사 자료를 쓰지 않습니다. 로컬 기존 이력 65개는 보존된 SQLite 사본과 동일한 것을 확인했습니다.

## 되돌리기

작업 전 커밋은 `158112b3e3aef2e7a47d9a858a6ca7e329918df6`, 보존 브랜치는 `backup/before-html-portfolio-20261016`입니다.

이 업데이트 후 HTML 자료나 즐겨찾기를 저장한 경우 이전 버전의 검증기는 새 형식을 지원하지 않습니다. 화면만 복구하려면 아래처럼 UI 파일만 이전 버전으로 되돌린 뒤 커밋하고 main에 반영합니다. HTML과 즐겨찾기를 읽는 저장 호환 코드는 유지됩니다.

```sh
git restore --source=158112b3e3aef2e7a47d9a858a6ca7e329918df6 -- src/workspace/MaterialsView.tsx src/workspace/ProjectsView.tsx src/main.tsx
git commit -m "Restore previous portfolio screens, keep HTML data compatibility"
git push origin HEAD:main
```

원본이나 데이터베이스를 삭제할 필요가 없습니다. 전체 소스 되돌리기는 먼저 최신 전체 JSON과 원본을 백업하고 새 자료 형식 호환성을 확인한 뒤 진행합니다.
