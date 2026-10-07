# 데이터 모델

Status: Accepted Alpha specification

Workspace: id, name, ownerIdentityId, recoveryHash, createdAt. Device: id, publicKeyJwk, displayName. WorkspaceIdentity: id, workspaceId, displayName. Membership: workspaceId/deviceId/identityId/revokedAt.

Page: id, workspaceId, parentId, kind(document/database), title Projection, revision, deletedAt. Parent는 같은 Workspace이며 Cycle을 허용하지 않는다. 구조 변경은 Revision과 Capability 검증을 거친다.

DocumentUpdate: resourceId, operationId unique, update bytes, sourceDevice, createdAt. DocumentCheckpoint: resourceId, encodedState, revision. Y.Doc: title Y.Text, content Y.XmlFragment, tasks Y.Map<Row Y.Map>. Task의 title은 Y.Text, description은 task:<id> Fragment다.

Invite: id, workspaceId/pageId, role, includeDescendants, secretHash, expiresAt, redeemedIdentityId, revokedAt. CapabilityGrant: id, identityId, pageId, role, includeDescendants, revokedAt.

Comment: id, pageId, authorIdentityId, parentId, body, resolved, createdAt. Challenge: id, deviceId, nonce, expiresAt. Session: tokenHash, deviceId, expiresAt. MetadataOperation: operationId, deviceId, payload, result.

Ownership: Workspace Owner Identity 관리; Device는 Membership으로 연결; Grant는 Identity 단위; 문서/Database는 Workspace 소속; Task Row는 Database 소속; Comment는 Page 소속. 삭제는 Trash 후 Owner의 영구 삭제. Export에는 소유권 Secret을 포함하지 않는다.

## Entity 책임과 삭제

| Entity                       | Owner/Relation                         | 원본                                | 삭제 정책                                       |
| ---------------------------- | -------------------------------------- | ----------------------------------- | ----------------------------------------------- |
| Workspace                    | Owner Identity, 여러 Device Membership | PostgreSQL                          | 명시적 이름 확인 후 연결 Entity Cascade         |
| Device                       | 브라우저 Profile의 공개키              | 서버 + Private Key는 해당 IndexedDB | Membership 철회로 Workspace 접근 차단           |
| WorkspaceIdentity/Membership | Workspace별 Identity와 Device 연결     | PostgreSQL                          | revoked_at 유지, Owner Recovery는 같은 Identity |
| Page                         | Workspace·부모 Page                    | Metadata는 PG, 제목/본문은 Yjs      | Trash는 Soft Delete, 자손 접근도 차단           |
| TaskDatabase                 | kind=database Page                     | Database Y.Doc                      | Page 정책 상속                                  |
| TaskRow                      | Database의 Y.Map + task Fragment       | Yjs                                 | deleted Field로 Soft Delete                     |
| Comment                      | Page·Author Identity·부모 Thread       | PostgreSQL                          | Workspace 삭제 시 Cascade                       |
| Invite                       | Page·Role·Descendants·Secret Hash      | PostgreSQL                          | 만료/수락/취소 상태 유지                        |
| CapabilityGrant              | Identity·Page 범위                     | PostgreSQL                          | revoked_at, 이후 요청 차단                      |
| DocumentUpdate               | Page·Operation UUID·Binary             | PostgreSQL                          | Workspace 삭제 시 Cascade, Alpha GC 없음        |
| DocumentCheckpoint           | Page·Binary·갱신 시각                  | PostgreSQL                          | 파생 저장, 편집 API 원본으로 사용하지 않음      |
| SyncOperation                | UUID·기기·결과/Revision                | PG 승인 기록 + Dexie Queue          | 승인 결과 재전송에 사용                         |

현재 TaskDatabase/TaskRow는 Page Kind와 CRDT Entity로 구현하고 별도 관계형 편집 원본을 만들지 않는다. 공유 Type은 DTO 경계를 정의하고 PostgreSQL 제약·Repository Transaction이 소유권과 Cascade를 집행한다. Due Date는 시간 없는 문자열이고 수신 DateTime Metadata는 화면 표시에서만 변환한다.

## Beta Entities

Task 확장: Row의 nullable `parentTaskId`/정수 분 `estimateMinutes`, Row ID별 최상위 `task-labels:<id>`/`task-dependencies:<id>` Map이 편집 원본이다. 읽기 Type은 labels/dependencyIds 배열로 제공하며 기존 Row는 빈 기본값으로 읽는다. 같은 Database의 Row ID만 새 연결할 수 있고 삭제된 연결은 Task를 지우지 않는다. `taskTemplates`는 캡처한 Task/사용자 정의 Property 정의와 값, `task-template:<id>`는 독립 XML 본문이다. 이 데이터의 별도 관계형 편집 원본이나 Migration은 만들지 않는다. 파일/Relation 참조는 Snapshot/Import의 기존 소속 검증과 ID 재매핑을 따른다.

`schema_migrations`는 적용된 SQL Version을 기록한다. `beta_codes`는 Secret Hash·만료·최초 수락 Device를 기록하고 `beta_devices`는 Device의 생성 자격을 연결한다. `workspaces.beta_code_id`로 자격당 생성 수를 계산한다. Owner Recovery가 같은 자격을 새 Device로 이어준다. 기존 Alpha Workspace의 자격 FK는 NULL이며 데이터는 유지한다.

`document_checkpoints.through_update_id`는 포함된 Commit 위치다. `document_operations`는 정리된 Update의 Operation ID·Page ID·Payload Hash를 보존한다. Page 삭제 시 둘 다 Cascade한다. `document_snapshots`는 별도 immutable Yjs State, Version, 종류, 이름, UTC 자동 생성 날짜, 생성 Device를 기록한다. Page/Workspace hard delete 시 Snapshot도 Cascade한다. `snapshot_operations`는 생성/복구 재시도의 Device·대상·동작·결과를 기록한다. 이 결과에는 본문이나 인증 Secret을 저장하지 않는다.
