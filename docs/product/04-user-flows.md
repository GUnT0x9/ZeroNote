# User Flows

Status: Accepted Alpha specification

각 Flow는 아래 Entry/Steps/Success/Error/Edge를 구현 기준으로 사용한다.

## First Visit

- Entry Point: 첫 방문
- Steps: Device Key 생성 → Workspace 생성 또는 Invite 진입
- Success State: 로그인 없이 초기 화면
- Error State: Crypto/Local 저장 실패 안내
- Edge Case: Invite 방문은 Workspace 생성 강제 없음

## Workspace Creation

- Entry Point: 생성 버튼
- Steps: 이름 입력 → UUID/Recovery Key 생성 → Local 저장 → 서버 등록
- Success State: Owner Workspace와 Inbox
- Error State: Offline이면 등록 대기
- Edge Case: Key 저장은 나중에 가능하나 분실 위험 안내

## Workspace Recovery

- Entry Point: 복구 버튼
- Steps: 새 Device 인증 → Key 입력 → 서버 검증 → Metadata/문서 복구
- Success State: 같은 Owner Identity
- Error State: Key 오류/서버 Offline
- Edge Case: 동기화되지 않은 원래 기기 데이터는 복구 대상 아님

## New Device Pairing

- Entry Point: 새 기기
- Steps: Alpha Owner는 Recovery를 사용
- Success State: Owner 권한 이어받기
- Error State: Key 분실
- Edge Case: 일반 멤버 Pairing은 Deferred

## Create Page

- Entry Point: New Page/Child
- Steps: UUID/부모 지정 → Local 문서 생성 → Metadata Queue → Sync
- Success State: 편집 가능한 Page
- Error State: 권한/부모 충돌
- Edge Case: Cycle과 Workspace 간 부모 금지

## Create Database

- Entry Point: New Project
- Steps: Task Database Page 생성 → 빈 Row 집합
- Success State: Table/Board 같은 데이터
- Error State: 권한/Local 저장 실패
- Edge Case: Row는 같은 권한 경계

## Quick Capture

- Entry Point: 버튼/Shortcut
- Steps: 입력 Focus → 내용/Destination → Local 저장 → 닫기
- Success State: Inbox 문서
- Error State: 저장 실패 시 입력 유지
- Edge Case: Enter 줄바꿈, Cmd/Ctrl Enter 저장

## Share Page

- Entry Point: Share Panel
- Steps: Role/자손 범위 → Invite 발급 → Fragment Link → 수락
- Success State: 기기 Identity Grant
- Error State: 만료/사용됨/권한 없음
- Edge Case: 초대 취소와 Grant 철회 별도

## Temporary Share

- Entry Point: 후속
- Steps: Deferred
- Success State: 향후 만료 Capability
- Error State: Alpha에 Action 노출 없음
- Edge Case: 기본 Invite 만료와 구분

## Realtime Collaboration

- Entry Point: 공유 Page
- Steps: 세션 → Scoped Token → Room → Awareness/Update
- Success State: 두 기기 상태 수렴
- Error State: 연결 오류/철회
- Edge Case: Viewer update 거절

## Offline Edit

- Entry Point: 접속 해제
- Steps: Local hydration → 편집/저장 → Pending 유지
- Success State: 내용 보존
- Error State: Quota 오류
- Edge Case: 현재 기기에 Cache된 문서만 접근

## Sync Recovery

- Entry Point: 재접속/재시도
- Steps: 인증 → Metadata → 문서 Commit → Comments
- Success State: DB Ack 후 동기화 완료
- Error State: 409/403/삭제
- Edge Case: Local 보존본과 재적용 제공

## Version Restore

- Entry Point: 후속
- Steps: Deferred; Alpha는 Export/Import
- Success State: 향후 Snapshot Restore
- Error State: Alpha에 History Action 없음
- Edge Case: 소유권/권한을 되돌리지 않음

## Create Branch

- Entry Point: 후속
- Steps: Deferred
- Success State: 향후 독립 Draft
- Error State: Alpha Action 없음
- Edge Case: CRDT Sync와 승인 Merge 구분

## Merge Branch

- Entry Point: 후속
- Steps: Deferred
- Success State: 향후 Review/Merge
- Error State: Alpha Action 없음
- Edge Case: 충돌 UX 후속 설계

## Publish Page

- Entry Point: 후속
- Steps: Deferred
- Success State: 향후 Public Page
- Error State: Alpha Action 없음
- Edge Case: Private 초대와 공개 URL 분리

## Workspace Export

- Entry Point: Settings
- Steps: Local 저장 완료 대기 → 문서/Task 직렬화 → 다운로드
- Success State: Versioned JSON
- Error State: 저장 실패/잘못된 파일
- Edge Case: Secret과 권한 제외

## Workspace Delete

- Entry Point: Owner Settings
- Steps: 이름 확인 → Online 요청 → 권한/문서 제거 → Local 전환
- Success State: 삭제된 Workspace 종료
- Error State: Offline/Owner 아님
- Edge Case: 다른 Workspace는 유지
