# Local-first Sync

Status: Accepted Alpha specification

UI → Yjs / Local Database → Sync → 서버 → PostgreSQL. UI는 서버 Round Trip을 기다리지 않고 Local 데이터를 표시한다.

y-indexeddb는 Y.Doc을 저장한다. Dexie는 Workspace/Page Metadata, 검색 Projection, 기기 Key, Pending Metadata/Comment, 미전송 문서 Snapshot을 저장한다. 미전송 Snapshot은 Local 저장 성공 확인과 장애 시 보존에 사용한다.

Metadata Operation은 UUID operationId, workspaceId, targetId, expectedRevision, payload를 가진다. 서버는 재시도 중복을 막고 Revision 불일치는 409로 반환한다. 구조 충돌은 Local 의도를 유지하고 사용자에게 재적용을 제공한다.

순서: Device 인증 → Workspace 등록 → Page 등록/구조 변경 → 문서 update commit → Comments. Offline 생성 Page는 서버 Metadata 등록 전에 Realtime Room에 접속하지 않는다.

문서 dirty generation을 추적한다. HTTP durable commit은 update와 operationId를 받고 PostgreSQL Transaction 성공 후 확인한다. 편집이 Commit 요청 중 계속되면 새 generation은 계속 Pending이다. Provider synced 이벤트를 Durable Ack로 쓰지 않는다.

삭제/철회 결과는 로컬 보존본 상태로 전환한다. 서버 권한을 CRDT 데이터로 변경할 수 없다. 재접속은 Exponential Backoff와 명시적 재시도를 지원한다. Alpha에서는 CRDT 로그를 제거하는 GC를 시행하지 않는다.

Service Worker는 정적 App Shell/Asset만 Cache하며 인증 API는 Cache하지 않는다. 최초 접속은 Online이 필요하다. Persistent Storage를 요청하지만 Local 데이터만으로 영구 보존을 약속하지 않는다.

## 상태와 장애 계약

| State             | 의미                                | 가능한 동작                | 성공 조건                      |
| ----------------- | ----------------------------------- | -------------------------- | ------------------------------ |
| 이 기기에 저장 중 | 메모리 변경이 Local 저장 대기       | 계속 편집                  | y-indexeddb/Dexie 저장 성공    |
| 이 기기에 저장됨  | Local Snapshot 존재, 서버 확인 대기 | 편집·Export                | PostgreSQL 상태 확인           |
| 서버 동기화 완료  | 표시한 Generation이 DB에 존재       | 정상 작업                  | Commit 또는 읽은 Snapshot 일치 |
| Offline           | Cache와 IndexedDB로 동작            | 문서·Task·Capture·Comments | Network 복귀 후 전송           |
| 저장/동기화 실패  | Quota/전송 오류                     | 내용 유지·재시도·Export    | 재시도 성공                    |
| 구조 충돌         | 기대 Revision이 다름                | 내 구조 변경 재적용        | 새 Revision으로 승인           |
| 로컬 보존본       | 접근 철회/원격 삭제로 제출 불가     | 읽기·복사본 Export         | 새 Workspace로 Import 가능     |

Trigger는 편집·Queue 생성·Online 이벤트·주기 Poll이다. 문서를 저장하는 동안 추가 편집이 발생하면 이전 Generation만 완료로 처리한다. 실패한 Local 저장은 Flush에서 재시도할 수 있다. Cache는 최초 App Shell/JS/CSS/Pretendard Asset을 미리 준비하고 인증 응답을 포함하지 않는다.
