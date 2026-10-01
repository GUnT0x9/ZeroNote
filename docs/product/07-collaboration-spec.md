# 협업 명세

Status: Accepted Alpha specification

공동 편집 경계는 일반 Page 또는 Task Database다. Workspace 전체 내용을 한 Y.Doc에 담지 않는다. Yjs update는 Hocuspocus로 전달한다.

Presence는 접속자·Cursor를 표시한다. 서버가 인증된 Identity를 Awareness에 덮어써서 클라이언트 이름·Role 위조를 권한 판단에 사용하지 않는다. 연결 해제 후 Presence를 제거하며 Presence는 영구 기록하지 않는다.

Comments는 Page 단위 Thread, 답글, 해결 상태를 갖는다. Author는 서버의 Workspace Identity다. Viewer는 읽기만 가능하고 Commenter/Editor/Owner는 작성 가능하다. 원문 Inline Anchor, Mention Notification은 후속 기능이다.

Offline Comment는 UUID 기반 Queue로 저장한다. 재전송은 같은 ID로 중복 방지한다. 권한이 사라진 Pending Comment는 실패 상태로 남기며 작성 내용 복사 가능하다.

Offline 편집은 CRDT 병합한다. 권한 철회·삭제된 문서의 변경은 서버에 제출하지 않고 로컬 보존본으로 남긴다. DB Commit 확인 전에는 서버 동기화 완료를 표시하지 않는다.

## 기능 계약

| Trigger           | Behavior                        | Offline                       | Sync                       | Error                            | Acceptance Criteria                  |
| ----------------- | ------------------------------- | ----------------------------- | -------------------------- | -------------------------------- | ------------------------------------ |
| Room 연결         | 문서 범위 Token으로 인증        | Local 편집 계속               | 초기 상태/차이 Update 교환 | Token·Origin·권한 거절           | 두 기기의 내용 수렴                  |
| 다른 기기 편집    | 같은 Fragment/Task Map 변경     | 로컬 Replica 보존             | 재접속 CRDT 병합           | 서버 저장 실패 시 완료 표시 금지 | Offline 변경과 Online 변경 모두 남음 |
| Presence Update   | 인증된 이름/ID/색 표시          | Presence는 지속 저장하지 않음 | Awareness만 전파           | 위조 이름/Role 덮어쓰기          | Cursor와 접속자 표시                 |
| Comment 작성/답글 | Device Membership Identity 사용 | UUID Queue 저장               | 재시도 중복 방지           | 철회된 Queue 항목은 실패 상태    | 서버에 한 Comment만 생성             |
| Thread 해결       | resolved 상태 갱신              | Online 필요                   | 서버 승인 결과 Cache       | Viewer 변경 거절                 | 해결 Thread 숨기기/다시 열기         |
| Grant/Device 철회 | 기존 연결을 종료                | 로컬 문서는 유지              | 이후 요청에서 권한 재검사  | 미전송 변경은 보존본             | 접근 불가 문서의 원격 쓰기 거절      |

원격 Update를 받은 Client도 DB 저장 확인 없이 완료로 표시하지 않는다. Editor는 Commit 응답을 사용하고 Viewer/Commenter는 서버에서 읽은 상태와 로컬 Yjs Snapshot을 비교해 확인한다. State Vector뿐 아니라 Delete Set도 비교해 삭제 변경을 빠뜨리지 않는다.
