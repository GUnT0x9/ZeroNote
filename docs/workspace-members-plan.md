# Workspace Member·Group 구현 기준

2026-10-07 Accepted implementation defaults. 전체 미완료 요구 42(Workspace Member 관리)·43(Member Group)를 실제 Owner 관리와 Page 공유에 연결한다. 전체 목표 148개 중 완료는 60개이며 구현 기반만으로 완료 수를 올리지 않는다.

## Member와 권한

Workspace Identity를 사람 단위로 묶고 연결 기기·활성/철회 상태·개별 Page Grant·그룹을 보여준다. Owner Recovery 기기는 같은 Owner Identity로 표시한다. 협업자는 기존 Page 초대로 참여한다. Owner만 다른 Member의 접근/그룹을 관리하며 자기 Owner Identity를 제거할 수 없다. Member 제거는 개별 Grant·모든 기기의 Membership·그룹 참여를 함께 철회하고 작성한 문서/댓글을 지우지 않는다. 새 초대 수락은 새로운 참여로 처리한다.

현재 Identity의 표시 이름을 변경할 수 있다. 서버가 Membership으로 Identity를 결정하며 임의 작성자 ID를 받지 않는다. 이름은 Workspace별이고 실명 인증이 아니다.

## Group 공유

Owner는 그룹 이름과 활성 구성원을 만들고 수정/삭제한다. 빈 그룹은 허용한다. Page에 그룹별 Editor/Commenter/Viewer와 하위 Page 포함 여부를 지정한다. 그룹 구성 변경은 현재 그룹 공유에 즉시 적용한다. 개별 Grant와 다른 그룹 공유가 남으면 가장 강한 유효 Role을 유지한다. 그룹 삭제는 해당 그룹 경로의 접근만 종료한다. 다른 Workspace의 Identity/Page/Group은 허용하지 않는다.

현재 그룹 구성과 별개로 새로운 그룹의 Page 공유를 확인해야 한다. 그룹 생성 자체로 Page 접근을 부여하지 않는다. 기존 Page 초대/REST DTO와 원본 CRDT는 유지한다.

## Offline·실패·동기화

권한과 그룹 변경은 Online에서 서버가 승인한다. Offline에서는 캐시한 목록을 읽되 관리 버튼은 비활성화하고 마지막 확인 상태를 표시한다. 초안은 오류 때 유지한다. Operation ID·Payload Hash로 재시도/동시 전송을 중복 적용하지 않는다. Group/Grant Revision 충돌은 최신 상태를 읽고 사용자 초안을 보존하여 다시 적용하도록 한다. 멤버/그룹/공유 변경은 문서 저장과 같은 lock에서 승인하고 Commit 후 활성 WebSocket 연결을 종료하여 권한을 다시 검사한다. 유휴 Polling을 추가하지 않는다. 권한 철회 후 Offline 문서 변경은 기존 로컬 보존/Export 정책을 따른다.

## API와 검증

`/v1/workspaces/:id/members` 목록/멤버 철회, `/profile` 본인 조회/이름 변경, `/member-groups/:groupId` 생성/수정/삭제, `/group-access` 공유와 `/group-access/:grantId` 철회를 추가한다. 개인 Grant 수정/철회는 `/members/:identityId/grants/:grantId`에서 처리한다. 공유 Zod 계약·repository/service·기존 인증/Origin 검사를 사용한다.

검증은 Owner/비Owner/철회 기기, Workspace 교차 입력, 동일 Operation 재전송/ID 충돌/동시 적용, Revision 충돌, 빈/중복/철회 멤버, 그룹 공유의 Role 중첩과 하위 Page, 삭제/재초대·Recovery, REST·WebSocket 즉시 철회, Offline 초안/보존, 두 기기·모바일·기존 초대/댓글/검색/복구 호환을 포함한다. lint/type-check/test/test:e2e/build/Docker·Migration 백업 복원과 실제 HTTPS 검증 후 완료로 반영한다.

Verified 2026-10-07: 이 기획을 `86c9a01`로 구현·배포하고 CI·실제 HTTPS 검증을 완료했다. 채택 당시 완료 수 60에서 현재 62/148로 갱신했으며 86개를 계속 구현한다. [최종 검증 기록](workspace-members-release.md).
