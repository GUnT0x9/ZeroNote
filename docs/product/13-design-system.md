# Design System

Status: Accepted Alpha specification

전역 폰트 Pretendard, letter-spacing -0.02em, line-height 1.5. Code 영역만 monospace를 사용한다. 폰트는 Self-host하여 Offline Asset Cache에 포함한다.

Neutral Background, Surface, Text, Muted, Border, Blue Accent, Danger를 CSS Custom Property로 정의한다. Light/Dark/System Theme에 같은 의미 Token을 사용한다. Gradient와 과도한 Shadow를 피하고 얇은 경계선으로 영역을 나눈다.

Spacing은 4px 단위, Control 높이는 Desktop 32–40px, Mobile 주요 Touch Target은 44px 이상. 문서 제목 Desktop 36px/Mobile 28px, UI 기본 14px, 본문 16px로 시작한다.

Primitive: Button, IconButton, Input, Select, Dialog, Drawer/Sheet, Menu, Status Badge, Empty State, Toast/Inline Error. Icon-only Control은 접근 가능한 이름을 가진다. Hover-only Control은 Focus에서도 표시한다.

키보드 Focus는 명확한 Accent Outline으로 표시한다. 상태를 색상만으로 전달하지 않는다. prefers-reduced-motion을 존중하고 최소한의 Transition만 사용한다.

## 구성요소 규칙

- Sidebar: 240px, 중성 회색 Surface, Page 선택과 Hover를 구분한다. 긴 이름은 Ellipsis와 전체 이름 안내를 제공한다.
- Content: Desktop은 왼쪽 여백 80px에서 시작하고 Editor 본문 최대 760px을 유지한다. Database는 넓은 콘텐츠를 사용한다. 저장 상태는 Sidebar 상단 아이콘에 모은다.
- Context Panel: 320px, Share/Comments/Properties/Backlinks의 한 영역만 연다. Mobile은 Sheet 형태다.
- Button/Input: 같은 Border·Radius·Focus Ring을 사용하고 읽기 전용과 Disabled 상태를 구분한다.
- Dialog: aria-modal·제목 연결·초기 입력 Focus·Tab 순환·Escape·닫힌 뒤 Focus 복원을 지원한다.
- State: 연결·저장 Spinner는 중심을 유지하며 회전한다. 상태 이름은 접근 가능한 Label과 상세 Popover에서 제공한다. PostgreSQL Commit 확인 전에는 서버 저장 완료로 표시하지 않는다. 실패·권한·빈 결과를 색만으로 구분하지 않는다.
- Typography: 자체 제공 Pretendard Variable, 기본 자간 -0.02em·행간 1.5. Code만 고정폭 폰트를 사용한다.
- Theme: Light/Dark/System을 Local Preference로 저장하고 시스템 Theme 변경도 반영한다.

Tokens는 `apps/web/src/app/globals.css`에 둔다. 메인 화면의 제공된 Figma Vector는 `public/design-icons/`에 보관하고 원래 크기로 표시한다. 나머지 Icon은 Lucide를 사용하며 의미 있는 Button에 접근 가능한 이름을 붙인다. Drag/Drop만으로 기능을 제공하지 않고 Status Select도 유지한다.

Figma 1차 기준: [ZeroNote — After](https://www.figma.com/design/iQog3GWOiNuR62OG13OKC8/ZeroNote?node-id=3-715). Sidebar 240px, Header 60px, 중성 Surface, 얇은 Border, Radius 4px/Panel 8px, 작은 Shadow를 사용한다. 색상 대비와 Mobile Touch Target은 구현에서 보완한다. Modal 배경에 Blur를 사용하지 않는다.
