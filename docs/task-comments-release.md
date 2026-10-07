# Task 댓글 구현 기록

2026-10-07 구현 중. 미완료 항목 36(Task별 Comment Thread)·53(Task별 Comment)는 같은 Row 범위 Thread 기능으로 제공한다. CI·배포·실제 HTTPS 검증 전에는 완료 수를 올리지 않는다. 현재 검증 완료 58/148, 미완료 90개다.

## 동작

Task 상세의 Comments는 해당 Row ID의 Thread·답글·해결/재열기를 표시한다. Database 자체의 Page 댓글과 구분하며 Task 이름을 바꿔도 연결을 유지한다. Page/Task별 입력 초안과 답글 대상을 기기에 저장하고 전환/Reload 때 복원한다. Viewer는 읽기만, Commenter/Editor/Owner는 댓글을 작성한다. Task 본문 권한은 바꾸지 않는다.

Local Queue 저장과 초안 제거는 하나의 transaction으로 처리한다. 저장 실패 때 입력을 비우지 않는다. 부모 Thread를 답글보다 먼저 전송하고 기존 댓글 ID로 재시도한다. POST Commit 확인 후 GET만 실패하면 acknowledged 상태로 보존하고 재조회만 한다. 늦은 요청 응답은 Scope 전환에서 취소/무시하고 캐시는 동일 Page/Row만 교체한다.

삭제/권한/ID 충돌/용량 거절은 원본 Queue를 보존하고 복사·재시도·기기에서 제거를 제공한다. 대기 답글이 있는 부모는 답글부터 제거한다. 삭제된 Task의 대기 댓글은 Database Page 댓글 패널에서도 확인한다. 입력창은 저장 후 Focus를 되찾으며 Cmd/Ctrl+Enter와 Touch를 지원한다. 유휴 Polling과 상단 저장 알림은 추가하지 않는다.

## API와 저장

Migration 009는 `comments.row_id`와 `(page_id,row_id,created_at,id)` Index를 추가한다. 기존 댓글은 null Row의 Page Thread로 보존한다. 기존 GET·POST·PATCH에 선택형 Row ID만 확장하며 Page GET은 직전 Web의 strict DTO와 호환되게 기존 필드만 반환한다.

CommentStore/CommentService는 문서 Commit과 같은 Content lock/Page lock의 transaction에서 권한·활성 Row·같은 범위 root parent·본문/부모/작성 Identity에 대한 ID 재사용을 검증한다. 동일 입력의 재시도는 새 저장·용량 검사 없이 기존 성공을 확인한다. Pool 안의 transaction executor로 접근 검사를 실행하여 동시 요청에서 Pool 재진입을 피한다. Resolve는 root/Scope/권한을 확인하고 권한/삭제 작업과 같이 콘텐츠 용량 제한에 막히지 않는다.

Snapshot/새 Page 복구는 Task 내용만 복제하고 Comments·초대·권한을 복제하지 않는다. 새로운 환경변수, Yjs 원본 형식, Editor Protocol 변경은 없다. 배포는 암호화 백업 → CI 확인 → Render(Migration) → Vercel이며 DB를 자동 되감지 않는다.

## 검증 상태

서버·공유 계약 집중 9 Tests, Local Queue/초안/동기화 14 Tests와 초기 전체 475 Tests/56 files 통과. 초기 브라우저의 삭제 Task/모바일 Focus 흐름은 통과했고 역할·전환 흐름은 `To-Do` 제목을 과거 이름으로 기대한 테스트를 수정했다. 최종 로컬 전체 476 Tests/56 files 통과(200.54초), lint/type-check/Web·Server build 통과. 취소된 지연 응답을 포함한 Local 댓글/동기화 15 Tests 통과. Task 범위/초안/Offline/역할/Snapshot 흐름 38.2초, 삭제 Task 보존/모바일 Focus 18.4초 통과. 기존 협업·Comments·Viewer·Recovery 23.7초, Mobile Touch 편집/Capture/Comments 15.4초로 브라우저 4개가 모두 통과했다(2.9분). CI·Production 결과는 아래에 추가한다. 실제 Android Chrome/iOS Safari 기기 검증은 아직 하지 않았다.

## 변경 파일과 이유

| 파일                                                                                                                    | 변경 이유                                                                    |
| ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `packages/shared/src/comments.ts`, `index.ts`                                                                           | 선택형 Scope Schema·URL·부모 전송 순서·기존 DTO 호환                         |
| `apps/server/src/database/comment-store.ts`, `comment-service.ts`, `routes.ts`, `services.ts`, `database/repository.ts` | Transaction 댓글 저장·권한/Row/부모/재시도 검증·서비스 분리                  |
| `apps/server/src/database/migrations.ts`, `migrations/009-task-comments.sql`                                            | 기존 댓글 보존과 Row 조회 Index                                              |
| `apps/web/src/components/comments-panel.tsx`, `context-panel.tsx`, `app/globals.css`                                    | Task/Database 댓글 범위·답글/해결·실패 복구·모바일 입력                      |
| `apps/web/src/lib/comments.ts`, `database.ts`, `sync.ts`                                                                | 초안 직렬화·Queue/ACK·캐시 범위·문서 Commit 이후 전송                        |
| 공유/서버/Local Tests, `tests/workspace.spec.ts`, CI                                                                    | 기존 데이터·동시 재시도·권한·Offline·두 기기·모바일·Migration 백업 복원 회귀 |
