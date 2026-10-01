# 정보 구조

Status: Accepted Alpha specification

Workspace는 독립된 소유권·복구·권한 경계다. Device 한 개는 여러 Workspace의 멤버가 될 수 있다.

Sidebar: Workspace 전환 / Search / Quick Capture / Inbox / Favorites / Pages / 공유받은 Page / Trash / Settings. Page Tree는 접근 가능한 일반 Page와 Database를 표시한다. Task Row는 Database에서 열고 일반 Tree를 불필요하게 채우지 않는다.

Page 종류: document, database. document는 Nested Pages를 가질 수 있다. database는 Task Row와 Row 본문을 포함한다. Row는 논리적 Page이지만 Database 권한과 동기화 경계를 공유한다.

Private/Shared를 별도 중복 저장 영역으로 만들지 않는다. 공유받은 Page는 Capability로 접근하는 같은 원본이다. 권한이 없는 부모 제목·형제 Page를 Metadata 응답에 포함하지 않는다.

Favorite는 기기별 편의 정보다. Inbox는 Workspace별 기본 Capture Destination이다. Trash는 삭제 상태의 Page이며 복원 후 같은 ID를 유지한다. 영구 삭제와 Workspace 삭제는 Owner의 Online 작업이다.
