# CLAUDE.md

이 저장소의 작업 규칙은 [AGENTS.md](AGENTS.md)에 있습니다. Claude Code도 같은 규칙을 따릅니다.

@AGENTS.md

## Claude Code 메모

- 사용자는 한국어로 대화합니다. 사용자에게 보이는 앱 문구도 한국어로 씁니다.
- `main`은 사용자가 승인한 최종 배포에만 씁니다. 개발은 별도 브랜치에서 하고, 소스만 저장하는 커밋에는 `[skip netlify] [skip ci]`를 붙입니다.
- 실제 Firebase, Drive/OneDrive 데이터나 사용자 계정으로 시험하지 않습니다. 테스트는 가짜 저장소와 모의 응답만 씁니다.
- 명령: `npm ci`, `npm test`(node:test), `npm run build`(tsc + vite), `npm run build:preview`, `npm run test:e2e`(Playwright).
- 호스팅 이전 계획: Netlify → Vercel ([docs/VERCEL.md](docs/VERCEL.md)). 파일 저장소 이전: Google Drive → OneDrive 개인 계정 ([docs/ONEDRIVE.md](docs/ONEDRIVE.md)). 두 작업 모두 사용자가 정식 배포를 요청하기 전까지 `main`에 반영하지 않습니다.
