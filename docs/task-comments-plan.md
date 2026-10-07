# Task별 Comment 구현 기준

2026-10-07 Accepted implementation defaults. 전체 미완료 요구 중 Task별 Comment Thread(36)와 Task별 Comment(53)는 같은 Row 범위의 Thread/답글/해결 사용 흐름으로 구현한다. 기반 코드만으로 완료로 집계하지 않는다.

Verified 2026-10-07: `522637e`의 CI 479 Tests/29 E2E/Docker/512MiB/암호화 복원과 실제 HTTPS 7개 흐름을 통과하고 Render → Vercel에 배포했다. [구현·배포 기록](task-comments-release.md). 전체 60/148 완료·88개 계속 개발.

## 동작

Task 상세에서 Comments Context Panel을 열면 선택한 Task의 Thread만 표시한다. Database 자체를 열면 기존 Page Thread를 표시한다. 각각 제목과 범위를 표시하고 이동/전환하면 Draft/답글 대상/해결 필터를 올바른 범위로 관리한다. Row 제목 변경 후에도 안정적인 Row ID를 사용한다. Snapshot/복제의 새 Page는 원본 Comments를 자동 복사하지 않는다.

새 Thread와 답글, 해결/재열기, 해결 목록, 서버 새로고침과 Realtime 변경 알림을 기존 Page Comments의 UI·Identity·권한으로 제공한다. Row별 별도 Share는 만들지 않는다. Viewer는 읽기, Commenter/Editor/Owner는 Comment 쓰기 권한을 갖는다. 댓글에 필요한 Row 존재 검사 때문에 Commenter에게 본문 편집 권한을 부여하지 않는다.

## 데이터·API 호환

- PostgreSQL Comment에 nullable Row ID를 더하고 Page/Row/시간 조회 Index를 버전 Migration으로 적용한다. 기존 Comment는 Row ID null인 Page Thread로 보존한다. Task Row 원본은 계속 해당 Page의 Yjs 문서다.
- 기존 `/v1/pages/:id/comments`에 선택형 Row Query를 추가하고 `/v1/comments` 입력은 선택형 Row ID로 확장한다. Page 범위의 응답은 직전 Web의 strict DTO와 호환되게 기존 필드만 유지한다. 기존 생성/해결 API 응답도 유지한다. Task Query는 해당 Row의 Thread만 반환한다.
- 서버가 Page 권한·활성 Row 존재·부모 Thread의 같은 Page/Row 범위와 깊이를 검사한다. 다른 Page/Row의 답글, 자기/누락 부모, Viewer 쓰기와 삭제된 Task의 새 쓰기를 거절한다. Resolve는 실제 Comment의 Scope를 확인한다.
- 같은 Comment ID/기기 Identity/범위/본문의 재시도는 같은 결과다. 다른 범위/본문/Identity로 ID를 재사용하면 409다. 동시 답글과 Resolve는 Transaction으로 승인한다. 클라이언트가 보낸 작성자 이름/Role을 권한 판단에 사용하지 않는다.

## Offline과 오류

Local Queue와 캐시된 Comment에 Row 범위를 보존하고 새 Row의 Metadata/문서 Commit 이후 Comment를 전송한다. Local 저장을 확인한 뒤 입력을 비우며 전송 실패로 내용이 사라지지 않는다. Parent Reply Queue를 먼저 전송하고 응답 재시도에서 Thread/답글을 중복 생성하지 않는다.

Task가 삭제되거나 권한이 철회된 경우 전송되지 않은 Comment를 서버의 다른 범위로 옮기지 않는다. 실패한 Local Comment를 표시하고 복사/재시도/Local 제거를 제공한다. 읽기/일시적인 연결 실패를 권한 철회로 추측하지 않는다. Scope 전환 시 오래된 응답은 취소/무시하고 로컬 캐시를 해당 Page/Row로만 읽는다. 유휴 DB Polling과 서버를 깨워 두는 요청은 추가하지 않는다.

## 검증

공유 Schema의 기존 DTO/새 Scope, 기존 Comment 보존 Migration, 같은 범위 Thread/Reply/Resolve, Cross Scope/누락/삭제/권한 거절, ID 충돌/동시 재시도, Task Rename와 Snapshot의 Comment 미복제, Local 저장 실패와 Offline Reload/재전송을 happy/edge 테스트로 확인한다. 두 기기 Page/Task 구분과 Realtime, Touch/Focus/Keyboard를 Browser에서 검증한다. lint/type-check/test/test:e2e/build/Docker/암호화 복원·실제 HTTPS를 확인한 뒤 완료 목록을 갱신한다.
