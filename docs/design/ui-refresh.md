# ZeroNote UI 개편 기록

사용자가 요청한 kill-ai-slop 정리와 왼쪽 상단 저장 아이콘을 반영했다. 메인 화면은 제공된 [ZeroNote — After](https://www.figma.com/design/iQog3GWOiNuR62OG13OKC8/ZeroNote?node-id=3-715)를 기준으로 구현했다. 제공되지 않은 과거 디자인 선호는 추측하지 않았다.

## 변경 내용과 이유

| 파일·영역                                                                              | 변경과 이유                                                                                                                                                                       |
| -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `components/sidebar.tsx`, `lib/ui-store.ts`                                            | Search → Workspace 전환 → Pages 위계, 전체 폭 선택 상태, 새 페이지 Row, Pages 접기와 Sidebar 접기. 목록을 빠르게 탐색한다.                                                        |
| `components/document-view.tsx`                                                         | Share·즐겨찾기·Page 메뉴로 상단을 정리한다. Comments·Properties·Backlinks·기록은 Page 메뉴, Mobile Comments는 직접 접근을 유지한다.                                               |
| `components/sync-status.tsx`, `lib/sync-status.ts`, `lib/hooks.ts`                     | 평상시 저장 알림바를 상단 아이콘으로 바꾼다. 문서 Commit, Page Metadata, Workspace 등록, 대기 Comments를 확인하며 실패 시 상세 정보와 재시도를 제공한다.                          |
| `components/workspace-app.tsx`, `lib/workspace.ts`                                     | 첫 화면의 슬로건과 반복 안내를 정리한다. 새 Workspace는 빈 시작 문서와 To-Do를 만들며 기존 사용자 문서와 제목은 보존한다.                                                         |
| `app/globals.css`                                                                      | Figma의 좌측 정렬·Sidebar 240px·Header 60px·얇은 Border를 반영한다. Blur와 큰 Shadow를 제거하고 Pretendard·자간 -0.02em·행간 1.5를 유지한다. 주요 Mobile Control은 44px 이상이다. |
| `components/design-icon.tsx`, `public/design-icons/`                                   | 제공된 Vector Asset을 로컬에 저장하고 원래 크기를 유지한다. Mask 색상은 Theme에 맞춘다. 임시 Figma URL을 제품 코드에 남기지 않는다.                                               |
| `public/sw.js`                                                                         | 새 정적 Icon을 App Shell Cache에 포함한다. 인증 API Cache 정책은 유지한다.                                                                                                        |
| `components/task-database.tsx`, `block-editor.tsx`, `context-panel.tsx`, `dialogs.tsx` | Table·Board 상태를 접근 가능한 이름으로 제공하고 문구·작업 상태·간격을 정리한다.                                                                                                  |
| Unit·E2E Tests                                                                         | 저장 확인 지연·실패·재시도·레이아웃 유지·Reduced Motion, 새 탐색·즐겨찾기, Offline Asset, 기존 Alpha/Beta 흐름을 검증한다.                                                        |
| 제품 명세·Decision Log·2차 요청서                                                      | 실제 메인 배치와 후속 디자인 요청의 범위를 기록한다.                                                                                                                              |

Quick Capture와 Inbox는 Desktop의 Workspace 전환 메뉴에서 접근한다. Mobile Capture와 Cmd/Ctrl+Shift+Space는 유지한다. 기능이 없는 프로젝트 관리·회의록 예시 메뉴는 생성하지 않는다. Task 생성 Button, Presence, 권한·저장 공간·구조 충돌 경고 등 실제 작업에 필요한 요소는 유지한다.

## 스캔과 수동 확인

kill-ai-slop scanner: 이전 30 Files/32 Hits → 개편 후 35 Files/22 Hits. 숫자는 휴리스틱의 의심 항목이며 결함 개수를 의미하지 않는다.

남은 항목은 기능상 유지했다.

- 완료 Todo/Task의 취소선과 실제 문서 링크의 밑줄.
- 사용자가 작성하는 문서 Block인 Callout.
- Presence Avatar·Comment Avatar·상태 Dot의 원형.
- Code와 Recovery Key의 고정폭 폰트.
- 고정 중심 Spinner의 선형 회전. 브라우저 검증에서 Reduced Motion 시 회전이 꺼지는지 확인한다.

Desktop 문서·Comments·Table·Board·Capture·Settings, Light/Dark, 새 Workspace 화면과 Mobile 문서·Comments를 비교한다. 검증용 문서와 이미지에는 Recovery Key·초대 Secret을 넣지 않는다. 로컬 캡처는 Git에서 제외한 `.local/ui-refresh/`에 보관한다. Desktop의 19개 실제 표시 Icon Slot을 로컬 SVG와 원래 크기로 확인했다.

## 검증 결과

- `lint`, `type-check`, `test`: 통과. Unit/Server 104 Tests.
- `build`, `test:e2e`: 통과. Chromium E2E 10 Tests. 저장 지연·507 실패·재시도·Escape/외부 클릭 닫기·Reduced Motion과 기존 협업·Offline 흐름을 확인했다.
- 성능 Fixture: 1,000 Pages, 500 Blocks, 1,000 Task Rows. 최종 검증에서 캐시 문서 열기 184ms, Local Search 39ms.
- Chromium Desktop/Touch Viewport에서 검증한다. 실제 Android Chrome·iOS Safari 기기 검증은 이번 작업에서 실행하지 않았다.

[2차 디자인 요청서](second-round-brief.md)에 우선순위·필요 상태·디자이너에게 보낼 문안을 정리했다.
