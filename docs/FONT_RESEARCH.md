# 관리형 웹앱 폰트 조사

조사 기준일: 2026-10-17. 제작자가 공개한 공식 저장소와 설명을 확인했습니다. 서비스별 실시간 CSS 전수 조사는 아니며, 아래 사용 사례는 폰트 제작자가 소개하는 사례입니다. Vercel과 Linear의 서비스 페이지는 이 실행 환경에서 접속이 제한되어 공식 GitHub 자료로 범위를 좁혔습니다.

## 비교

| 글꼴 | 확인한 공식 근거 | 이 앱에 적합한 위치 |
| --- | --- | --- |
| Inter | 제작자 README에 Figma, GitLab 사용 사례가 기재되어 있습니다. 화면용으로 설계했고 숫자 폭을 맞추는 tabular numbers를 제공합니다. | 영문 UI, 날짜와 통계. 한글은 별도 글꼴 필요 |
| Geist Sans | Vercel이 협업 제작한 글꼴입니다. 공식 설명은 가독성과 단순함, 스위스 타이포그래피의 영향을 밝힙니다. | 영문 제목, 브랜드. 한글은 별도 글꼴 필요 |
| Pretendard | 공식 README는 Inter와 본고딕 등을 기반으로 한다고 설명하며 flex, 커리어리 등을 사용 사례로 소개합니다. | 한글이 많은 본문, 기관명, 표, 메뉴에 우선 추천 |
| Noto Sans KR | Google Fonts 공식 설명은 한글을 위한 산세리프 디자인이라고 명시합니다. | 문서 중심 화면의 안정적인 한글 대안 |

업무 도구나 개인 포트폴리오가 모두 한 글꼴을 사용하는 것은 아닙니다. 특정 사이트가 현재 모든 화면에서 위 글꼴을 쓰는지는 별도 확인이 필요합니다. 참고로 받은 네 번째 이미지의 정확한 폰트는 이미지 만으로 확정할 수 없습니다.

## 현재 앱 확인

- 본문 `src/styles.css`는 Pretendard를 첫 번째 후보로 선언하지만, 실제 Pretendard 파일이나 웹폰트 로딩 선언은 없습니다. 설치하지 않은 PC에서는 다음 후보 글꼴로 표시됩니다.
- 제목과 주요 탐색 메뉴에는 `src/refinements.css`가 Paperlogy를 지정합니다. 500, 600, 700 굵기를 `public/fonts/`에서 직접 제공합니다.
- 차트 축은 별도 `sans-serif` 선언을 사용합니다. 향후 본문 글꼴을 통일할 때 함께 정리할 부분입니다.

## 권장 방향

본문과 메뉴는 Pretendard 400/500, 강조는 600, 큰 제목과 브랜드만 기존 Paperlogy 500/600을 권합니다. 현재처럼 긴 경력명과 기관명이 많은 화면에서는 굵은 제목용 글꼴을 메뉴 전체에 쓰기보다 본문용 글꼴로 정보 밀도를 낮추는 편이 좋습니다.

영문과 숫자에 Inter를 별도로 적용하는 것은 선택 사항입니다. Pretendard 자체가 Inter를 기반으로 하므로 처음부터 글꼴을 세 종류로 늘릴 필요는 없습니다. 차트 수치와 날짜 열에는 `font-variant-numeric: tabular-nums` 적용을 검토할 수 있습니다.

실제 적용 시 라이선스와 함께 WOFF2 파일을 직접 제공해야 PC마다 같은 모양을 유지할 수 있습니다. 현재 사이트는 `font-src 'self'` 정책이므로 외부 CDN만 연결하는 방식은 맞지 않습니다. 이번 작업에서는 조사와 추천만 수행하며 앱의 폰트는 바꾸지 않았습니다.

## 확인한 원문

- [Inter 제작자 README, 사용 사례와 화면용 설계](https://github.com/rsms/inter#readme)
- [Vercel Geist 공식 README](https://github.com/vercel/geist-font/blob/main/readme.md)
- [Pretendard 공식 한국어 README, 소개와 사용 사례](https://github.com/orioncactus/pretendard/blob/main/packages/pretendard/README.md)
- [Google Fonts의 Noto Sans KR 설명](https://github.com/google/fonts/blob/main/ofl/notosanskr/DESCRIPTION.en_us.html)
