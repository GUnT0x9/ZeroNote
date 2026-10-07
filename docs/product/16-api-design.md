# API 설계

Status: Accepted Alpha specification

Base /v1. JSON 요청·응답은 공유 Zod Schema로 검증한다. 성공은 2xx, 유효성 400, 세션 401, 권한 403, 미존재 404, Revision/중복 소유권 충돌 409, 만료 410, 제한 429, 서버 실패 500/503으로 반환한다. 응답에 Stack/Secret을 포함하지 않는다.

Device register → Challenge → Signature verify → HttpOnly Session. Workspace create/recover/rotate/delete, accessible Metadata list, Page create/update/delete/restore, Metadata Operation 처리, Invite create/redeem/cancel와 Grant revoke, Comment list/create/reply/resolve, Device list/revoke를 제공한다.

문서 GET은 권한이 있는 Binary State를 반환한다. Commit은 operationId와 Base64 Yjs Update를 받고 DB Commit 후 해당 operationId 확인을 반환한다. Realtime Token은 resourceId로 Scope를 제한하고 짧게 만료한다.

Mutation에는 허용 Origin과 세션 검증을 적용한다. Invite/Recovery Secret은 Body에서만 받고 URL Query나 로그에 넣지 않는다. WebSocket 연결과 메시지에서도 Resource Capability를 재검사한다.

구현된 정확한 Method/Path/Request는 docs/api.md를 기준으로 함께 갱신한다. Routes는 Validation/Service/Response만 담당한다.

Task Comments는 기존 Page 댓글 Method에 선택형 `rowId`를 추가한다. GET Query, POST 본문, Resolve PATCH 본문은 동일한 활성 Row 범위를 검사한다. 미지정/null은 Page Thread이며 Page GET에는 Row 필드를 추가하지 않는다. 댓글 ID 재시도는 작성 Identity·Page/Row·부모·본문이 같을 때만 허용한다. 다른 입력은 409, 범위가 다른 부모는 400, 삭제 Row는 410이다.

Workspace Member/Group API는 `members.ts` 공유 계약과 service/repository를 사용한다. Owner만 전체 Identity/기기/개별·그룹 Page 권한을 관리하고 활성 Member는 본인 이름만 변경한다. Operation/Payload Hash·Revision으로 동시 변경을 확인한다. 그룹 공유의 현재 구성원과 기존 개별 Grant를 같은 권한 계산에 합치며 Commit 후 연결을 종료한다. [정확한 Method·Body](../api.md), [구현 기준](../workspace-members-plan.md). UI·CI·Production 검증 전에는 전체 완료 수를 올리지 않는다.
