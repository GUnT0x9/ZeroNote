# Versioning과 Branching

Status: Accepted Alpha specification

Alpha의 DocumentUpdate/Checkpoint는 내구성과 재시작 복구용이다. 사용자에게 완성된 Version History나 Git Branch로 표시하지 않는다.

후속 1: Named Snapshot과 자동 Snapshot, 문서/Task Database 단위 Restore. Restore는 현재 문서에 새로운 변경으로 적용해 연결된 기기에 반영한다. 권한과 Invite는 과거 Snapshot으로 되돌리지 않는다.

후속 2: 문서/Block Diff, 삭제된 Block·Property 표현, Restore 전 현재 상태 Snapshot. Code Block은 Text Diff를 사용하고 Database Property는 Field Diff를 사용한다.

후속 3: Page Branch의 실제 리뷰 용도를 검증한 뒤 구현한다. Branch 기준 Snapshot과 공통 조상을 기록하고 CRDT 실시간 병합과 사용자 승인 Merge를 구분한다. 내용·참조·Task Row의 Merge 정책은 이 단계에서 결정한다.

DEC 상태: 사용자 Version History, Compare, Branch/Merge는 Deferred. Alpha 코드가 미래 Merge 알고리즘을 가정하지 않는다.
