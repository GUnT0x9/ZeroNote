# ZeroNote API

Base path `/v1`, 같은 Origin REST와 `/collaboration` WebSocket을 사용한다. Zod 계약은 `packages/shared/src/index.ts`에 있다. Route는 service/repository를 사용하며 Component가 DB에 접근하지 않는다.

Mutation에는 정확한 `WEB_ORIGIN`의 `Origin` Header가 필요하다. 인증은 P-256 공개키 등록 → 짧은 수명의 Challenge → ECDSA SHA-256 서명 확인 → HttpOnly Session Cookie다. Challenge는 한 번만 사용할 수 있다. JSON Error는 `{error:string}`이고 400은 입력 오류, 401은 Device 인증 실패, 403은 권한/Origin 거절, 409는 Revision 충돌, 410은 삭제/만료/소비된 초대, 429는 Rate Limit이다.

| Method | Path                                | 입력/결과                                                    | 접근                             |
| ------ | ----------------------------------- | ------------------------------------------------------------ | -------------------------------- |
| GET    | `/health`                           | `{status:'ok'}`                                              | 공개                             |
| POST   | `/devices`                          | `{id,name,publicKey}`                                        | 공개/Rate Limit                  |
| POST   | `/auth/challenge`                   | `{deviceId}` → `{id,nonce}`                                  | 공개/Rate Limit                  |
| POST   | `/auth/verify`                      | `{challengeId,signature}` → Cookie                           | 서명                             |
| GET    | `/metadata`                         | 접근 가능한 Workspace/Page/Identity/Role                     | Device                           |
| POST   | `/search`                           | 공유 Search AST → Page/Row 결과·Snippet·오타 표시            | Device/접근 가능한 범위          |
| GET    | `/pages/:id/search-properties`      | 선택한 Database의 활성 Property 정의                         | Viewer 이상/삭제 제외            |
| POST   | `/workspaces`                       | `{id,name,ownerIdentityId,createdAt,recoveryHash}`           | Device                           |
| POST   | `/workspaces/recover`               | `{key}` → Workspace                                          | Device/Rate Limit                |
| POST   | `/workspaces/:id/recovery`          | `{key}` → 이전 Key 교체                                      | Owner/Online                     |
| DELETE | `/workspaces/:id`                   | `{name}` 이름 확인                                           | Owner/Online                     |
| GET    | `/workspaces/:id/devices`           | 등록된 기기 목록                                             | Owner                            |
| DELETE | `/workspaces/:id/devices/:deviceId` | 기기 철회                                                    | Owner/다른 기기                  |
| POST   | `/sync/page`                        | PageOperation → Page                                         | Create: Owner, 수정: Editor 이상 |
| GET    | `/documents/:id`                    | `{update:Base64}`                                            | Viewer 이상                      |
| POST   | `/documents/:id/commit`             | `{operationId,update}` → `{operationId,durable:true}`        | Editor 이상                      |
| POST   | `/documents/:id/realtime-token`     | `{token}` 문서 범위 5분                                      | Viewer 이상                      |
| POST   | `/invites`                          | `{pageId,role,includeDescendants}` → `{id,secret,expiresAt}` | Owner                            |
| POST   | `/invites/:id/redeem`               | `{secret}` → `{workspaceId,pageId}`                          | Device                           |
| GET    | `/pages/:id/share`                  | Grant와 Secret 없는 Invite 상태                              | Owner                            |
| DELETE | `/pages/:id/grants/:grantId`        | 수락한 권한 철회                                             | Owner                            |
| DELETE | `/pages/:id/invites/:inviteId`      | 미수락 초대 취소                                             | Owner                            |
| GET    | `/pages/:id/comments`               | Thread와 답글                                                | Viewer 이상                      |
| POST   | `/comments`                         | `{id,pageId,parentId,body}`                                  | Commenter 이상                   |
| PATCH  | `/pages/:id/comments/:commentId`    | `{resolved}`                                                 | Commenter 이상                   |

PageOperation은 UUID `operationId`, `workspaceId`, `pageId`, `expectedRevision`, `action`을 받는다. `create`는 `page`, `move`는 `parentId`를 받는다. UUID 재전송을 중복 처리하지 않는다. 다른 기기의 Page 구조가 바뀌면 409로 응답하고 Client는 로컬 의도를 유지한 채 재적용을 제공한다.

문서 Commit은 Yjs Binary의 Base64이며 최대 Binary 5MB다. Operation ID는 같은 문서·같은 Update에만 재사용할 수 있다. Client의 저장 완료는 PostgreSQL Update 저장과 Checkpoint 후 응답을 받았을 때다. Projection을 CRDT와 별도로 편집하는 API는 없다.

WebSocket Token은 `deviceId`, `resourceId`, 만료·Issuer·Audience를 검증한다. 인증 Role로 readOnly를 설정하고 매 Message에서 현재 권한을 다시 확인한다. 철회 시 활성 Room 연결을 종료한다. Awareness user 값은 서버가 확인한 Identity로 덮어쓴다. Viewer·Commenter의 CRDT Update를 수락하지 않는다.

초대는 7일·1회 사용이며 Secret Hash만 저장한다. 같은 기기의 성공 요청 재전송은 허용한다. 동시 수락은 DB Row Lock으로 한 기기만 승인한다. Grant의 범위는 Page 기본, Descendants 옵션 선택 시 하위 Page, Database의 Task Row는 Database 권한을 상속한다.

새 Page Metadata 생성과 Workspace 관리·공유 정책 관리는 Alpha에서 Owner가 수행한다. 초대된 Editor는 문서·Task 편집과 기존 Page Metadata 수정 권한을 가진다. 일반 멤버의 새 Page 생성 정책은 권한 모델 확장 시 조정한다.

## Beta API

기존 `/v1` 계약을 유지한다. 아래 Endpoint는 Session 인증을 요구하고 Mutation은 고정 `WEB_ORIGIN`을 검사한다. Snapshot은 Trash에서도 Workspace Owner만 접근한다.

| Method | Path                           | Request                     | Response                                           |
| ------ | ------------------------------ | --------------------------- | -------------------------------------------------- |
| GET    | /v1/beta/status                | —                           | required, approved, workspaceCount, workspaceLimit |
| POST   | /v1/beta/redeem                | code                        | Beta Status                                        |
| GET    | /v1/storage                    | —                           | bytes, warning, blocked                            |
| GET    | /v1/pages/:id/snapshots        | —                           | Snapshot metadata[]                                |
| POST   | /v1/pages/:id/snapshots        | operationId, name(optional) | Snapshot metadata                                  |
| GET    | /v1/snapshots/:id              | —                           | metadata + Base64 update                           |
| DELETE | /v1/snapshots/:id              | —                           | deleted                                            |
| POST   | /v1/snapshots/:id/restore-copy | operationId                 | new Page                                           |

Snapshot metadata: id, pageId, kind(manual/automatic), name, schemaVersion(1), createdAt. UUID Operation ID로 재전송을 식별한다.

Beta 코드는 Hash만 저장한다. Recovery/Page Invite는 Beta 자격을 요구하지 않는다. 신규 Workspace는 자격당 3개로 제한한다. Snapshot 생성/복구는 Operation ID·Device·대상·동작을 확인하여 재시도한다. 권한은 서버에서 검증한다.

저장 공간 부족은 507, 문서 크기 초과는 413, Operation 충돌/수동 Snapshot 제한/Version 미지원은 409다. Durable Ack는 PostgreSQL Commit 후 반환한다. REST와 WebSocket은 같은 Transaction 저장 경로를 사용한다.

# Page attachments

기기 Cookie 인증과 Page Role을 기존 문서 API와 동일하게 적용한다. 모든 응답은 `no-store`이며 Service Worker가 인증 응답을 Cache하지 않는다.

| Method | Path                                     | 권한 / 응답                                                                                                                               |
| ------ | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/v1/pages/:id/attachments`              | Page 접근자. 삭제되지 않은 파일 Metadata 목록. `?retained=1`은 Owner만 사용하며 Trash/보존 파일 이름을 포함한다. bytes는 반환하지 않는다. |
| POST   | `/v1/pages/:id/attachments`              | Editor/Owner. `{ operationId, id, name, data }`, data는 canonical base64. PostgreSQL Commit 후 Metadata                                   |
| GET    | `/v1/attachments/:id`                    | Page 접근자. Metadata + base64 data. Owner는 Trash/보존 파일도 조회                                                                       |
| GET    | `/v1/attachments/:id/content`            | Page 접근자. 원본 bytes와 Range 지원(206/416), `nosniff`/강제 다운로드                                                                    |
| DELETE | `/v1/attachments/:id`                    | Editor/Owner. 목록에서 삭제. Snapshot용 bytes는 참조가 없어질 때까지 유지                                                                 |
| GET    | `/v1/workspaces/:id/attachments/storage` | Owner. bytes/count/retained/limit/fileLimit/files                                                                                         |

Beta 파일 제한: 파일당 4MiB, Workspace당 25MiB/200개. 동일 Operation ID/파일 ID의 같은 요청은 중복 저장하지 않는다. 다른 Payload로 재사용하면 409, 저장 한도는 507이며 로컬 bytes/재시도 Operation ID를 보존한다. MIME은 서버가 signature로 판별하며 SVG/HTML 실행은 제공하지 않는다.

Snapshot 복구는 참조된 파일 bytes를 새 Page의 새 Attachment ID로 복사한다. 소스 Page와 Snapshot은 유지하며 Share Grant는 복사하지 않는다. Export version 2는 인증 Secret 없이 참조된 첨부를 포함하고 version 1 Import도 지원한다. Import는 파일 크기/Hash/Page 소속과 ID를 검증하고 새 Page/file ID로 재매핑한다.

## Editor 호환성

현재 Web은 `X-ZeroNote-Editor-Protocol: 4`를 사용한다. Header가 없으면 기존 Editor 1이다. 기존 문서는 최소 버전 1, Attachment Block은 2, File/Formula/Relation/Rollup 속성은 3, Tag나 미지원 Block/Mark는 4다. 서버 Checkpoint에 필요한 최소 버전을 유지하며 삭제된 속성 정의와 마지막 Tag 제거 후에도 호환성 경계를 적용한다. 미지원 버전의 읽기·쓰기·Token/미리보기는 426, 잘못된 Header는 400이다. 새 기능 방송 전에 활성 구버전 연결을 종료하고 WebSocket 인증·Sync에서도 검사한다. 로컬 변경은 유지하며 앱 새로고침을 안내한다. 버전 Header는 Role 권한을 부여하지 않는다. Migration 008은 기존 Checkpoint와 Update를 보존하며 Protocol 허용 범위를 1–4로 확장하고 파생 검색 Index를 추가한다. Index는 Commit/Checkpoint와 같은 transaction에 저장하며 검색 API는 다음 단계에서 연결한다.

Database의 File/Relation 값은 중복 없는 UUID 배열(최대 50개), Formula는 길이/노드/깊이를 제한한 속성 ID AST, Rollup은 Relation/대상 속성 ID/집계 연산 정의다. 계산 결과를 서버의 별도 편집 원본으로 저장하지 않는다. Commit 전에 공유 Schema와 File/Relation 값 형식을 검증하고 잘못된 정의는 422로 거절한다. Relation은 대상 접근 권한을 추가하지 않는다. Public Projection은 게시 범위 밖 Relation과 Person에서 파생한 결과를 반환하지 않는다.

## Storage 관리

Task 확장은 별도 편집 REST를 만들지 않고 기존 Database CRDT Commit/권한 경계를 따른다. Commit 전에 부모·선행 작업 순환, 잘못된 Estimate/Label/연결, Template 정의/개수/값을 공통 검증하며 REST와 WebSocket 모두 실패 상태를 저장 완료로 표시하지 않는다. 삭제된 부모/선행 작업은 남은 Task와 본문을 삭제하지 않는다. Template의 본문/File Property 참조도 비공개 파일 보존과 Snapshot/Import 복제에 포함되며 Public 범위에는 사용하지 않은 Template 파일을 포함하지 않는다. 상세 계약은 [Task 확장 기록](task-extension-release.md)을 따른다.

`GET /v1/workspaces/:id/attachments/storage`는 Workspace Owner에게 실제 bytes가 남은 파일과 `bytes/count/retained/limit/fileLimit`을 반환한다. `files[]`는 기존 Metadata에 `pageTitle`, `pageDeletedAt`, `deletedAt`을 더한다. bytes 원문이나 다른 Workspace의 목록은 포함하지 않는다. 집계는 동일 파일 목록에서 계산하고 주기적 Polling을 하지 않는다.

`DELETE /v1/workspaces/:id/attachments/:fileId/content`는 Owner와 정확한 `{name}` 확인을 요구한다. PostgreSQL의 문서 Commit/Snapshot/파일 저장과 같은 Lock을 사용해 현재 문서(Trash 포함)와 보관 중인 Snapshot에 참조가 없을 때만 bytes를 제거한다. 성공은 `{id,purged:true}`이며 같은 파일의 재시도는 같은 응답을 반환한다. 참조는 409, 이름 불일치는 400, 권한 없음은 403, 다른 Workspace/없는 ID는 404다. 일반 `DELETE /v1/attachments/:id`는 계속 soft delete다.

Migration 005는 파일 ID·원래 Hash/크기·Operation 기록을 유지하고 Payload만 제거한다. 정리된 파일 읽기/동일 Upload 재시도는 410, 다른 Payload를 같은 ID로 보내면 409다. 현재 문서는 자기 Page의 저장된 파일만 참조할 수 있다. 누락/다른 Page/영구 정리된 파일 참조는 REST와 WebSocket Commit을 422로 거절하며 서버 저장 완료로 표시하지 않는다. 로컬 변경과 파일 bytes는 남는다. 기기의 사본 제거는 미전송/보존/접근 철회/Trash 파일을 제외한다.

## Public 공유

Owner 전용 `GET/POST /v1/workspaces/:id/public-shares`, `DELETE /v1/workspaces/:id/public-shares/:shareId`를 추가한다. POST는 Operation ID, 공유 제목, 명시적 Page ID 목록(1–1,000), `public/temporary/burn`, UTC 만료 시각, 선택형 비밀번호(8–128자), 보호된 링크의 256bit Secret, SEO 허용을 받는다. Workspace Owner·Page 소속·Trash·중복·한도(활성 링크 100개)를 검사하며 같은 Operation/입력의 재시도는 같은 링크를 반환한다. 다른 입력/Workspace는 409다. 보호된 링크의 Secret은 브라우저가 발급해 URL Fragment로 전달하고 서버에는 Hash만 보관한다. 비밀번호는 새 Salt와 scrypt Hash로 보관한다. 만료는 최대 90일이다. 보호된 링크는 SEO를 허용하지 않는다.

익명 `GET /v1/public/:id`는 접근 게이트 정보만 제공한다. 보호된 링크의 문서 제목·목록·본문은 제공하지 않는다. `POST /v1/public/:id/open`은 Secret/선택형 비밀번호와 Operation ID/256bit Reader Secret을 확인한 뒤 해당 링크 경로에 Secure·HttpOnly·SameSite=Strict 읽기 Cookie를 발급한다(Production Secure). 10회/분 요청 제한을 적용한다. Secret/비밀번호/Reader Secret은 URL Query에 넣지 않는다. GET으로 Burn을 소모하지 않는다. Burn의 첫 POST만 Transaction으로 승인하고 승인 시점의 안전한 문서 Projection과 참조 파일 목록을 고정한다. 같은 Operation/Reader의 재시도는 같은 Session이며 다른 Reader와 Operation 충돌은 거절한다. Burn 읽기는 최대 1시간, 일반 보호된 공유는 최대 24시간이며 링크 만료/해제가 먼저면 접근을 종료한다.

`GET /v1/public/:id/content[/:key]`는 불투명 공개 Page Key·제목·안전한 읽기 HTML과 선택한 공개 목록, Canonical을 제공한다. CRDT Update/삭제된 과거 내용/Comments/멤버 Identity/Recovery/비공개 Page ID나 자동 제목을 포함하지 않는다. Database는 모든 활성 Row/일반 Property/Row 본문을 게시하며 Person Property는 Identity 노출을 피하기 위해 제외한다. Workspace의 새 Page나 하위 Page는 자동 게시하지 않는다. Parent Trash도 검사한다.

`GET /v1/public/:id/files/:fileId`는 활성 공개 Page에서 현재 참조하는 파일, 또는 승인된 Burn Session에서 고정한 파일만 제공한다. 다른 Page의 파일·미참조·삭제·영구 정리 파일은 거절하며 Range/Download/보안 Header는 기존 파일 응답과 동일하다. Burn Session의 유효한 참조 파일은 Storage 정리에서 보호하며 링크 해제/만료 후 정리할 수 있다. 모든 API 응답은 no-store, 모든 쓰기는 고정된 Web Origin 검사 대상이다. 익명 공유는 개인 REST/Realtime 접근 권한을 부여하지 않는다.

## 전체 검색

`POST /v1/search`의 공유 `SearchRequestSchema`: `{query:{clauses:[...]}, workspaceId:UUID|null, limit:1..50=30, overlays:[]=기본}`. Overlay는 `{pageId,projection:KnowledgeProjection,updatedAt:ISO}` 최대 32개이며 전송 중인 로컬 편집을 이번 읽기에만 적용한다. 현재 요청자에게 편집 권한이 없는 source는 사용하지 않는다. 요청 body는 기존 10MiB transport 제한을 따른다. 어떠한 검색 요청도 CRDT·Index·Checkpoint를 수정하지 않는다.

응답 `SearchResponseSchema`: `{hits:[{pageId,workspaceId,rowId:null|UUID,kind,title,pageTitle,workspaceName,snippet,updatedAt,tags,score,fuzzy}],searchedPages,unavailableProperties}`. 제목을 우선하며 정확한 결과가 오타 후보보다 앞선다. `searchedPages`는 Metadata 필터를 통과한 source 수다. 미해결 속성 값은 부정 조건에서도 결과에 포함하지 않는다. `GET /v1/pages/:id/search-properties`는 본문이나 파일 bytes를 반환하지 않는다.

Text는 Unicode NFKC/소문자/공백으로 정리한다. AND 조건, 따옴표·제외어, `type:page|database`, `tag:이름`, `workspace:UUID|"이름"`, `database:UUID`, `after:YYYY-MM-DD`, `before:YYYY-MM-DD`, `prop:속성ID|이름:연산자:값`을 지원한다. before는 UTC 수정일 미만, after는 해당 날짜 이상이다. Property는 contains/equals/not_equals/empty/not_empty/gt/gte/lt/lte를 Table과 같은 규칙으로 처리한다. 빈 값 조건에는 값을 적지 않으며 숫자/boolean을 typed 값으로 해석하고 따옴표 값은 문자열로 유지한다.

8 Page batch와 접근 가능 같은 Workspace의 Database 의존성을 사용하며 source 16MiB를 넘으면 422로 검색 범위를 줄이도록 안내한다. 동시 Search 2개를 넘으면 429를 반환한다. 인증·Origin·Trash·철회 검사는 기존 REST와 동일하다. Search POST는 읽기 전용이므로 일시적인 502/503/504에만 제한된 재시도를 허용한다. 취소된 요청은 재시도하지 않는다. [출시/검증 기록](search-release.md).

## 문서 연결

`POST /v1/knowledge`는 읽기 전용이며 `{pageId,offset:0=기본,overlays:[]=기본}`을 받는다. Offset은 현재 Page의 직접 연결 문서를 199개씩 탐색한다. Page와 Database를 Node로 표시하며 Task/Relation의 Row 연결은 Database로 묶고, Backlinks에서는 원래 Row 본문으로 이동할 수 있다.

응답 `KnowledgeResponseSchema`는 `root`, 최대 200개 `nodes`, 최대 800개 방향성 `edges`, `neighborCount/edgeCount/offset`, `incoming/incomingCount`, 최대 12개 `related`, `issues/issueCount`를 포함한다. Graph·추천·개수에는 허용된 활성 Page만 사용한다. Incoming과 Issue 목록은 각각 최대 200개이며 전체 개수를 함께 반환한다. Graph의 다음/이전 문서 탐색과 선택 문서 중심 이동을 제공한다.

매 요청마다 Session·Origin·현재 Page Role·상위 Trash를 검사한다. Relation은 같은 Workspace의 접근 가능한 Database/활성 Row만 연결한다. 대상이 Metadata 범위 밖이면 존재 여부를 추가 조회하지 않고 `unverified`로 반환한다. 이미 접근 가능한 Metadata에 삭제가 확인된 대상은 `trashed`, 알려진 Database의 활성 Row가 없으면 `missing_row`다. Issue에는 비공개 대상 이름을 포함하지 않는다.

Overlay는 `{pageId,projection}` 최대 32개이며 현재 접근 가능하고 편집 가능한 Page에만 적용한다. 본문·Index·Checkpoint를 변경하지 않는다. 서버는 기존 source Index에서 링크·활성 Row 이름·Tag와 제한된 본문 근거를 읽는다. 같은 Body 정규화/점수 규칙을 Offline에서도 사용한다. 본문 근거는 앞 8,192자, 각 Row 본문 앞 1,024자와 최대 64개 단어로 제한하며 공통 단어를 제외한다. 관련 문서는 직접 연결 100점·공통 Tag당 12점·본문 단어당 1점으로 정렬하고 제목·ID로 같은 점수의 순서를 고정한다. 자기 자신·Trash·다른 Workspace의 추천을 제외한다.

전체 source head 16MiB와 동시 2개 요청 제한을 적용한다. 422/429와 Offline/연결 실패에서는 로컬 결과·범위를 표시한다. 새 Page의 Metadata 등록 대기 중에는 로컬 결과를 유지하며, 등록 후 서버 결과에 미전송 수정 Overlay를 적용한다. 일시적인 502/503/504 재시도만 허용하며 오래된 요청은 취소한다. Mutation·새 데이터 형식·Migration은 추가하지 않는다. 링크 교체는 기존 CRDT에 명시적으로 적용하고 로컬 저장 확인 후 기존 Commit Queue로 전송한다.
