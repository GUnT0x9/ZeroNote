# UI/UX 명세

Status: Accepted Alpha specification

Quiet, Focused, Precise, Content-first. 기본 Sidebar 240px, 문서 본문 최대 760px, Context 320px. Database는 넓은 Content를 사용한다.

Page Header는 Breadcrumb, 제목, Sync 상태, Presence, Share, Context Action을 제공한다. Comments/Properties/Backlinks/Share는 하나의 오른쪽 Panel을 공유하며 동시에 여러 Panel을 열지 않는다.

Sidebar Tree는 Expand/Collapse, New Child Page, Page 선택을 제공한다. Empty State는 다음 실제 동작으로 연결한다. 미구현 기능을 사용 가능한 Button으로 노출하지 않는다.

Mobile은 Sidebar Drawer와 Context Sheet를 사용한다. 읽기, Capture, Comments를 우선하며 Desktop 전용 편집 기능은 안내와 함께 제한한다. Dialog는 Focus Trap, Escape 닫기, Focus 복원을 적용한다.

Keyboard: Cmd/Ctrl+K Search, Cmd/Ctrl+Shift+Space Capture, Slash Arrow/Enter/Escape, Editor Undo/Redo. OS/Browser가 Shortcut을 가로채더라도 모든 동작은 화면 Button으로 접근 가능하다.

문서 Loading, Local 저장 중, Local 저장됨, 서버 동기화 중/완료, Offline, Sync 실패, 로컬 보존본을 구분한다. 오류는 원인과 실제 가능한 재시도·복사·Export 동작을 제공한다.
