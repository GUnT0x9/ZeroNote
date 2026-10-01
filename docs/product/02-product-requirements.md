# 제품 요구사항

Status: Accepted Alpha specification

## P0 요구사항

- Workspace: 브라우저 Device Key 생성, Workspace 생성·전환·복구·삭제, Key 재발급, 기기 철회.
- Page: 안정적인 UUID, 문서/Task Database, 부모 관계, 로컬 작성·이동·Trash, Favorite.
- Editor: Text, Heading 1–3, Bullet/Numbered, Todo, Toggle, Quote, Callout, Divider, Code, Page Mention; Markdown Shortcut, Slash, 공동 Undo.
- Task: 고정 Property, Table/Board, Row 상세 문서, Todo에서 Task로 변환.
- 협업: Page 초대와 Role, 공동 편집, 서버 확인 Presence, Page Comment Thread.
- Local-first: Local 저장 → Metadata Queue 등록 → 문서 전송 → DB Commit 확인. 연결만으로 동기화 완료를 표시하지 않는다.
- 데이터: Schema Version을 가진 Export/Import. 복구 Key·Private Key·Cookie·Invite Secret은 Export하지 않는다.

## Quick Capture 상세

Trigger: 버튼 또는 앱 내 Cmd/Ctrl+Shift+Space. 입력창으로 Focus 이동. Enter는 줄바꿈, Cmd/Ctrl+Enter는 저장. Destination은 Inbox를 기본으로 하며 접근 가능한 Page로 변경 가능. Local 저장 완료 후 닫고 서버 저장은 비동기 진행. 실패 시 내용을 유지하고 오류를 표시한다.

## 비목표

Alpha에서 일반 Database Property Builder, 파일 업로드, Canvas, Public/Burn Share, Branch, Automation, 외부 Integration, Desktop Global Shortcut을 구현하지 않는다. 제품 로드맵에서는 유지한다.

## Alpha 기능 계약

| Feature        | Trigger                   | Behavior                                                          | Offline                     | Sync                               | Error                                    | Acceptance Criteria                            |
| -------------- | ------------------------- | ----------------------------------------------------------------- | --------------------------- | ---------------------------------- | ---------------------------------------- | ---------------------------------------------- |
| Workspace 생성 | 첫 방문/Create            | Device Key·Owner Identity·Workspace·Inbox 생성, Recovery Key 표시 | 생성 가능                   | Workspace 등록 후 Page 등록        | 저장 실패 시 생성 성공으로 표시하지 않음 | 로그인 입력 없이 다음 방문에도 내용 유지       |
| Recovery       | 새 기기의 Recovery 화면   | Key Hash로 Owner Membership 등록                                  | Online 필요                 | 동기화된 문서와 Metadata 복원      | 잘못된 Key 거절                          | Owner Identity가 동일하고 기존 문서 편집 가능  |
| Page 생성/이동 | Sidebar +/Properties      | 부모 관계와 안정적인 UUID                                         | Operation Queue             | UUID 중복 방지·Revision 확인       | Cycle/다른 Workspace 부모/충돌 거절      | 중첩 문서 생성과 재적용이 원문을 보존          |
| Editor         | 문서 Focus                | Markdown Shortcut·Slash·Block Control                             | Local Y.Doc 편집            | 문서별 CRDT 병합                   | 저장 실패 표시, 입력 내용 유지           | 새로고침 후 Block/내용 보존                    |
| Page Mention   | `[[`                      | Page ID Node를 삽입하고 이름을 Metadata에서 표시                  | 로컬 목록 사용              | 동일 ID 유지                       | 접근 제한 표시                           | Rename 후 링크와 Backlinks 유지                |
| Search         | Search/Cmd Ctrl K         | 제목·본문·Task Projection 검색                                    | 로컬 Index                  | 권한 변경 후 접근 가능한 범위 반영 | 빈 결과는 빈 상태                        | 1,000 Pages 기준 200ms 목표                    |
| Task           | 새 Task/Todo 변환         | 고정 Property·논리적 상세 Page·Table/Board                        | 편집 가능                   | Database Y.Doc 단위                | 날짜 오류 거절, 변환 실패 시 Todo 유지   | 두 View와 상세 Property가 일치                 |
| Share          | Share Panel               | Role·Descendants 선택, 일회성 Secret 발급                         | Online 필요                 | Grant는 서버 승인                  | 만료·소비·취소·철회 구분                 | REST/WebSocket에서 같은 Scope와 Role 적용      |
| Presence       | Room 접속                 | 접속자와 Cursor를 표시                                            | 접속자 표시 제거            | 서버 확인 Identity                 | Token 만료 시 재인증 연결                | Client의 이름/Role 위조를 권한에 사용하지 않음 |
| Comments       | Context Panel             | Thread·답글·해결                                                  | 작성은 Queue, 해결은 Online | UUID 재전송 중복 방지              | 권한 철회 시 작성 내용과 실패 상태 유지  | 재접속 후 한 번만 제출                         |
| Quick Capture  | 버튼/Cmd Ctrl Shift Space | 즉시 입력 Focus, Destination 선택                                 | Local 저장 후 닫음          | Inbox 하위 Page 등록과 문서 전송   | 실패 시 입력창 유지                      | Enter 줄바꿈, Cmd Ctrl Enter 저장              |
| Trash          | Page 메뉴                 | Page를 숨기고 복원 가능                                           | Operation Queue             | Revision 승인                      | 권한·구조 충돌 표시                      | 하위 Page가 검색/탐색에서 함께 숨겨짐          |
| Export/Import  | Settings                  | Version 1 파일·새 ID·새 Workspace                                 | Local 데이터로 수행         | Import Metadata 후 문서 등록       | 버전/바이너리/중복 ID/순환 거절          | 문서·Task·내부 링크 보존, 인증 Secret 제외     |
| 접근 철회      | Owner Share/Devices       | 서버 접근 차단, 활성 Room 종료                                    | 이미 받은 로컬 사본은 보존  | 재접속 시 원격 덮어쓰기 금지       | 로컬 보존본과 Export 제공                | 이후 쓰기/읽기 거절과 미전송 데이터 보존       |

## 우선순위와 출시 판정

P0는 위 계약 전체다. 기능 메뉴의 존재만으로 완료 판정하지 않고 실제 Browser·PostgreSQL에서 대표 작업 흐름을 검증한다. 성능·Browser 호환성은 측정 환경과 함께 보고한다. E2EE, 파일, 일반 Property Builder, Native Desktop은 Deferred이며 Alpha UI의 기본 작업을 막지 않는다.
