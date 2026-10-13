# Introduce Me 작업 공간 확장

기존 경력과 공문 보관함에 프로젝트, 강의 자료, 대학원 탭을 추가합니다. React와 TypeScript, 기존 Firebase 무료 구성 및 로컬 SQLite를 그대로 사용합니다.

## 사용

- 프로젝트: 학년도와 교과로 분류하고 수업 흐름, 활동, 도구, 결과물 및 사진 링크, 성찰을 기록합니다.
- 강의 자료: 직접 제작한 자료와 수집한 자료를 구분합니다. 파일은 업로드하지 않고 Google Drive 또는 Google Docs 링크로 관리합니다.
- 대학원: 강좌, 마감일 순 과제, 논문 노트와 쪽수가 있는 인용문, 자유로운 주제 메모를 기록합니다.
- 통합 검색: 기존 이력과 공문, 새 탭의 항목을 함께 검색하고 태그로 좁힙니다.
- 연결: 한쪽에서 연결하면 반대쪽에서도 표시됩니다. 강좌를 삭제해도 과제와 논문은 남으며 강좌 연결만 해제됩니다.

## 데이터와 백업

기존 경력 필드, 공문 원본, 파일 저장 방식을 변경하지 않습니다. 새 데이터가 없는 기존 계정은 빈 확장 공간으로 시작합니다. 로컬 SQLite에는 별도의 확장 저장 영역을 자동으로 준비합니다. Firebase는 기존 경력의 활성 버전과 분리된 작업 공간 버전을 사용하므로 기존 보안 규칙 안에서 동작합니다.

전체 JSON에는 경력, 공문 메타데이터와 원본 참조, 프로젝트, 강의 자료, 대학원 항목과 연결이 들어갑니다. 공문 파일의 바이너리는 JSON에 포함되지 않습니다. Drive 원본을 유지하고, 원본 자체를 컴퓨터에 보관하려면 기존 전체 ZIP 백업을 사용하세요.

JSON 가져오기는 검증 후 항목을 합칩니다. 같은 ID에 서로 다른 내용이 있으면 현재 내용을 유지하고 충돌 목록을 보여 줍니다. 기존 경력 수정 사항을 조용히 덮어쓰지 않습니다. Firebase 무료 구성에서는 Drive에 남아 있는 원본의 본인 소유, 보관 폴더, 파일 크기와 SHA-256을 확인한 뒤 공문 정보와 경력 연결도 복구합니다. 로컬 환경에서는 원본이 없는 공문 메타데이터를 실제 파일처럼 복원하지 않습니다.

이전 형식의 ZIP이나 JSON에 새 탭 데이터가 없더라도 현재 새 탭의 기록을 지우지 않습니다. 새 전체 ZIP과 Drive 메타데이터 백업에는 확장 데이터를 함께 보관합니다.

## 되돌리기

확장 작업을 시작하기 전 체크포인트는 `4d725c32deb7b3143dff9cacb70bfbda7e75d9f7`입니다. 이 커밋에는 이전 디자인 개선과 공문 30개를 검토해 추가하는 기능이 들어 있습니다.

배포한 확장 커밋을 `git revert <확장 커밋 SHA>`로 되돌리고 다시 배포하면 이전 화면으로 돌아갑니다. 새 탭의 별도 저장 영역은 남으므로 확장 버전을 다시 배포하면 이어서 사용할 수 있습니다. 되돌리기 전에 전체 JSON과 원본 ZIP을 내려받아 두세요. `git reset --hard` 또는 데이터베이스 초기화는 필요하지 않습니다.

개발 환경의 개인 원본 데이터는 읽기 전용으로 복사한 `.cloud-local/pre-workspace-data/`에도 보존했습니다. 이 경로와 개인 증빙, 가져오기 코드는 Git에 포함하지 않습니다.

## 검증

```sh
npm run build
npm test
npm run test:e2e
```

테스트는 별도 임시 데이터베이스와 합성 자료를 사용합니다. 개인 `.data` 또는 실제 Firebase와 Drive에 쓰지 않습니다.

이번 구현에서 전체 테스트 183개와 브라우저 통합 테스트 8개, 프로덕션 빌드와 함수 빌드를 통과했습니다. 기존 데이터베이스의 별도 복사본을 실행해 경력 65개 표시를 확인했고 원래 경력과 공문 행이 바뀌지 않았음을 비교했습니다. 실제 사용자 계정의 클라우드 데이터는 테스트로 수정하지 않았습니다.

## 변경 파일

- 화면과 스타일: `src/App.tsx`, `src/BackupSettings.tsx`, `src/CareerEditor.tsx`, `src/EvidenceImport.tsx`, `src/ResumeBuilder.tsx`, `src/cloud.ts`, `src/display.ts`, `src/main.tsx`, `src/types.ts`, `src/workspace/GraduateView.css`, `src/workspace/GraduateView.tsx`, `src/workspace/MaterialsView.css`, `src/workspace/MaterialsView.tsx`, `src/workspace/ProjectsView.css`, `src/workspace/ProjectsView.tsx`, `src/workspace/Workspace.css`, `src/workspace/WorkspaceBackup.tsx`, `src/workspace/WorkspaceSearch.tsx`, `src/workspace/WorkspaceUI.tsx`, `src/workspace/types.ts`
- 저장, 백업과 공통 검증: `server/backup.mjs`, `server/free/files.mjs`, `server/free/repository.mjs`, `server/free/snapshot.mjs`, `server/index.mjs`, `server/store.mjs`, `server/workspace.mjs`, `shared/workspace.d.mts`, `shared/workspace.mjs`, `src/free/api.ts`, `src/free/backup.ts`, `src/free/evidence-import.ts`, `src/free/store.ts`
- 설정과 안내: `docs/WORKSPACE.md`, `netlify.toml`, `playwright.config.ts`
- 검증: `test/e2e.spec.ts`, `test/evidence-import-ui.test.mjs`, `test/free-backend.test.mjs`, `test/graduate-ui.test.mjs`, `test/materials-ui.test.mjs`, `test/projects-ui.test.mjs`, `test/workspace-concurrency-e2e.spec.ts`, `test/workspace-e2e.spec.ts`, `test/workspace-free.test.mjs`, `test/workspace-local.test.mjs`, `test/workspace-shared.test.mjs`
