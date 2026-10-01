# Versioning과 Branching

Status: Accepted Beta specification

Alpha의 Update/Checkpoint는 내구성과 재시작 복구용이다. Beta에서 사용자 Snapshot을 별도 Entity로 제공한다. Snapshot은 서버에 Commit된 Page 또는 Task Database 전체 상태이며 Owner만 생성·조회·삭제·복구한다.

Trigger: Context Panel/Trash의 기록. 수동 생성 전 Local 저장·서버 동기화를 확인한다. 변경된 문서의 하루 첫 Commit에 자동 기록을 만든다. UTC 기준 자동 7일/최대 7개, 수동 최대 3개다. Offline에서는 서버 기록 작업을 하지 않는다. 개수 초과는 409, 공간 부족은 507이며 원본·로컬 변경을 보존한다.

Restore는 새 CRDT 문서와 새 Page ID를 사용하는 비공유 Root Page로 수행한다. 자기 참조만 새 ID로 변경하고 외부 링크는 유지한다. Task Property/Row 본문과 날짜를 보존한다. Page 하위 구조·Comments·Invite·Grant는 복제하지 않는다. Trash에서도 Owner 복구를 허용한다. Operation ID 재시도는 같은 결과를 반환한다. 미리보기는 읽기 전용이다.

Acceptance: Owner 외 기록 접근 거절, 원본 내용·링크 유지, 복구 결과의 Page/Task 데이터 일치, 동시 편집 후 Commit된 Snapshot 복원, 지원하지 않는 Version 거절.

Deferred: 현재 문서 되감기, 문서/Block Diff, Compare, Branch/Review/Merge. Beta의 새 Page 복구는 기존 Alpha 후속안의 in-place Restore를 대체한다. 자세한 운영 정책은 `docs/beta-launch.md`를 따른다.
