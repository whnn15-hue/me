# 수업과 학급 자료

기존 프로젝트 탭은 `수업`으로 표시합니다. 수업 안에는 기존 포트폴리오를 유지하는 `수업 기록`과 활동지, 읽을거리, 학급 운영 자료를 모으는 `학급 자료`가 있습니다. 강의 자료 탭의 기존 항목은 그대로 유지합니다.

학급 자료는 제목, 직접 제작 또는 수집 구분, 제작자, 수업과 활동, 대상, 날짜, 형식, Google Drive 링크, 활용 메모와 태그를 기록합니다. HWP와 TXT 형식으로 필터할 수 있고, 수업이나 이력과 양방향으로 연결할 수 있습니다. 통합 검색의 `수업 전체`는 수업 기록과 학급 자료를 함께 찾고, `학급 자료`로 좁힐 수도 있습니다.

`수업 → 학급 자료 → 정리한 학급 자료 가져오기`에 IMMT1 코드를 입력하거나 전용 ZIP을 선택하면 검토한 자료를 추가합니다. 원본은 연결된 개인 Drive에 보관하고 앱에는 링크와 메모만 저장합니다. 공문이나 이력 항목을 새로 만들지 않습니다. 같은 ID의 자료가 이미 있으면 현재 수정 내용과 링크를 유지하고 다시 업로드하지 않습니다. 파일 링크와 메모는 전체 JSON, ZIP의 메타데이터와 Drive 자동 백업에 포함되며, 학급 자료 원본은 Drive에서 별도로 유지합니다.

원본은 공개 저장소에 넣지 않습니다. 배포용 묶음은 AES-256-GCM으로 암호화하고 복호화 키는 개인에게 전달하는 코드에만 둡니다. 전용 묶음은 전체 기록 복원에서 거부하므로 기존 데이터를 대체하는 백업으로 잘못 사용할 수 없습니다.

## 호환성과 되돌리기

기존 수업 저장 종류 `project`, ID, 기존 연결을 그대로 사용합니다. 학급 자료는 `material`의 선택 필드 `purpose: "classroom"`으로 구분합니다. 이전 자료에 이 필드가 없으면 강의 자료로 해석하며, 기존 행에 필드를 추가하는 데이터 이전은 하지 않습니다. 새 HWP와 TXT 형식은 기존 형식과 함께 허용합니다.

작업 직전 기준 커밋은 `b87accb144fe431c1322a481d3d70ac4c8d33011`입니다. 새 자료를 저장한 뒤 화면을 되돌릴 때는 새 형식을 읽는 검증 코드와 타입을 남깁니다. 먼저 전체 JSON과 Drive 원본을 보관하고 아래처럼 이 기능 커밋만 되돌립니다.

```sh
git revert --no-commit <수업 기능 커밋>
git restore --source=<수업 기능 커밋> -- shared/workspace.mjs src/workspace/types.ts
git commit -m "Revert classroom interface while retaining stored material compatibility"
git push origin HEAD:main
```

기존 화면에서는 학급 자료도 강의 자료 목록에 표시됩니다. 새 버전을 다시 적용하면 저장된 구분에 따라 수업 탭으로 돌아옵니다. 코드 되돌리기는 Drive 원본이나 기록을 삭제하지 않습니다.

## 변경 파일

- 화면과 검색: `src/App.tsx`, `src/workspace/ProjectsView.tsx`, `ProjectsView.css`, `MaterialsView.tsx`, `MaterialsView.css`, `MaterialImport.tsx`, `MaterialImport.css`, `WorkspaceUI.tsx`, `WorkspaceSearch.tsx`, `WorkspaceBackup.tsx`
- 형식과 가져오기: `shared/workspace.mjs`, `src/workspace/types.ts`, `src/free/material-import.ts`, `src/free/backup.ts`, `src/backup-code.ts`, `server/backup.mjs`
- 검증: `test/material-import.test.mjs`, `material-import-ui.test.mjs`, `materials-ui.test.mjs`, `projects-ui.test.mjs`, `backup-code.test.mjs`, `workspace-shared.test.mjs`, `workspace-e2e.spec.ts`, `workspace-concurrency-e2e.spec.ts`
- 배포 자료: `public/imports/`의 암호화된 학급 자료 묶음
