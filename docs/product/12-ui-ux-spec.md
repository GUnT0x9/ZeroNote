# UI/UX 명세

Status: Accepted Alpha specification

Quiet, Focused, Precise, Content-first. 기본 Sidebar 240px, 문서 본문 최대 760px, Context 320px. Database는 넓은 Content를 사용한다.

Page Header는 Breadcrumb, Presence, Share, 즐겨찾기, Page 메뉴를 제공한다. Comments/Properties/Backlinks/기록은 Page 메뉴에서 열고 Share는 직접 연다. 하나의 오른쪽 Panel을 공유하며 동시에 여러 Panel을 열지 않는다. Mobile은 Comments를 직접 열 수 있다.

Sync 상태는 왼쪽 상단 아이콘 한 곳에서 확인한다. 연결·서버 저장 중에는 중심을 유지하는 회전 모션, 완료·Offline·실패에는 서로 다른 아이콘과 접근 가능한 이름을 사용한다. 누르면 상세 상태·Offline 준비 상태·재시도를 제공한다. 반복 저장으로 알림바가 나타나거나 문서 위치가 바뀌지 않는다. 저장 공간·등록 거절·구조 충돌 등 사용자 조치가 필요한 경고는 유지한다.

Sidebar는 Brand/Sync/닫기 → Search → Workspace 전환 → Favorites/Pages → Trash/Settings 순서다. Quick Capture와 Inbox는 Workspace 전환 메뉴에 둔다. Mobile은 Quick Capture를 상단에 유지한다. 새 Workspace는 빈 시작 문서와 To-Do를 만들며 기존 문서 이름과 본문은 변경하지 않는다.

Sidebar Tree는 Expand/Collapse, New Child Page, Page 선택을 제공한다. Empty State는 다음 실제 동작으로 연결한다. 미구현 기능을 사용 가능한 Button으로 노출하지 않는다.

Mobile은 Sidebar Drawer와 Context Sheet를 사용한다. 읽기, Capture, Comments를 우선하며 Desktop 전용 편집 기능은 안내와 함께 제한한다. Dialog는 Focus Trap, Escape 닫기, Focus 복원을 적용한다.

Keyboard: Cmd/Ctrl+K Search, Cmd/Ctrl+Shift+Space Capture, Slash Arrow/Enter/Escape, Editor Undo/Redo. OS/Browser가 Shortcut을 가로채더라도 모든 동작은 화면 Button으로 접근 가능하다.

문서 Loading, Local 저장 중, Local 저장됨, 서버 동기화 중/완료, Offline, Sync 실패, 로컬 보존본을 구분한다. 오류는 원인과 실제 가능한 재시도·복사·Export 동작을 제공한다.
