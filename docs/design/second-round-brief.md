# ZeroNote 2차 디자인 요청서

1차 [ZeroNote — After](https://www.figma.com/design/iQog3GWOiNuR62OG13OKC8/ZeroNote?node-id=3-715)의 Sidebar·상단 도구·중성 색상과 여백을 기준으로 후속 화면을 설계한다. 실제 Beta 기능을 기준으로 하며 파일 업로드, Calendar, Public Share, 알림 Center 등의 미구현 기능은 포함하지 않는다.

## 요청 순서

| 우선순위 | 화면·Flow                            | 요청 이유                                                           | 필요한 상태                                                                                                                                                   |
| -------- | ------------------------------------ | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1        | Share·Page 초대·권한 관리            | 팀 사용의 핵심 진입이며 Role과 접근 범위를 명확히 전달해야 한다.    | Editor/Commenter/Viewer 선택, 하위 Page 포함 기본 꺼짐, 링크 생성·복사, 만료·1회 사용·사용됨, 초대 취소, 수락한 기기의 권한 철회, Owner 외 화면, Offline·실패 |
| 2        | To-Do Table·Board·Task 상세          | 1차의 Table을 기준으로 작업 생성과 관리 흐름 전체를 연결한다.       | 새 Task, 검색·빈 결과, Todo/In progress/Done 이동, 제목·담당자·마감일·우선순위, Task 본문, 읽기 전용, Mobile에서 상세 읽기                                    |
| 3        | Comments·기록·Snapshot 복구          | 공동 작업의 검토와 안전한 복구를 완성한다.                          | Thread·답글·해결, Offline 전송 대기·실패·재시도, 기록 목록·읽기 전용 미리보기, 수동 3개 제한, 삭제 확인, 새 Page로 복구, Trash에서 기록 복구, Owner 제한      |
| 4        | Mobile 메인·Drawer·Context Sheet     | Desktop 시안의 축소로 해결되지 않는 읽기·입력·키보드 동작을 정한다. | 360/390px, Sidebar 열기·닫기, 긴 제목, Share/Comments Sheet, 키보드 열린 입력·닫기·Focus, 44px 주요 Touch Target, Offline·저장 아이콘                         |
| 5        | Workspace 생성·초대코드·Recovery     | 계정 없는 첫 사용과 다른 기기 복구에서 혼동을 줄인다.               | 초대코드 정상·만료·사용됨·개수 제한, Workspace 이름, Recovery Key 복사·다운로드·보관 안내, 복구 입력·잘못된 Key·기기 철회                                     |
| 6        | Search·Workspace 전환·Settings·Trash | 일상 탐색과 데이터 관리의 세부 경험을 정리한다.                     | 검색 입력·결과·빈 상태·권한 제한, Favorites, Workspace 선택·생성, Theme, 기기 목록, Export/Import 진행·실패, Trash 복원·삭제 확인                             |

예산과 일정이 제한되면 1–4를 먼저 요청한다. 특히 Share와 Task 상세는 Desktop과 Mobile을 함께 설계한다.

## Quick Capture·Inbox에 대한 요청

기존 기능과 저장된 메모는 유지한다. 이번 메인 구현에서는 Desktop 주 메뉴에서 Workspace 전환 메뉴로 옮겼으며 Mobile의 Capture 버튼과 키보드 Shortcut은 유지했다.

2차에서는 빠른 메모의 목적을 **페이지를 정리하기 전에 기록하는 임시 입력**으로 정의한다. 입력 즉시 Focus, Enter 줄바꿈, Cmd/Ctrl+Enter 저장, 이 기기 저장 성공 후 닫기, 저장 위치 선택을 기준으로 작은 Dialog/Sheet를 요청한다. Inbox는 메모 목록과 일반 Page로 정리하는 동작을 보여준다. 일반 새 Page와의 차이를 행동과 문구로 표현하고 장식적인 소개 문장은 추가하지 않는다.

## 공통 전달 사항

- Pretendard, 기본 자간 -0.02em, 기본 행간 1.5. Light/Dark를 같은 의미의 Token으로 설계한다.
- 주요 Button, Input, Select, Menu, Dialog, Drawer/Sheet, 상태 표시를 재사용 가능한 Component/Variant로 제공한다. Hover, Focus, Selected, Disabled, Loading, Error, Read-only를 포함한다.
- 상단 도구는 Share·즐겨찾기·Page 메뉴를 기본으로 한다. Comments는 Mobile에서 직접 접근할 수 있게 한다.
- 저장 중에는 왼쪽 상단의 작은 회전 아이콘을 사용한다. 평상시 저장으로 문서 위에 알림바가 나타나거나 본문이 움직이지 않는다. 아이콘 클릭 시 상세 상태와 실패 재시도를 제공한다.
- 권한 철회·저장 공간·구조 충돌에는 실제 가능한 Copy/Export/Retry를 함께 제시한다. 연결 성공과 서버 저장 완료를 구분한다.
- Snapshot 복구는 원본을 유지하고 **비공유 새 Page**를 만든다. 하위 Page·Comments·초대·권한이 복사되는 것으로 표현하지 않는다.
- 실제 문서, 긴 이름, 10개 이상의 목록, 빈 목록을 넣어 레이아웃을 검증한다. 기능이 없는 예시 메뉴나 가짜 통계는 넣지 않는다.
- 각 Flow는 시작 화면부터 성공·오류까지 연결한 Prototype과 Auto Layout Frame, Token, Icon Asset을 전달한다. Desktop 1440px와 Mobile 390px를 기본으로, 360px에서도 확인한다.

## 디자이너에게 보낼 메시지

> 1차 시안의 Sidebar 위계, 여백, 상단 도구 정리 방향으로 메인 화면을 반영하고 있습니다. 2차는 실제 협업에 필요한 Share·초대·권한 관리, To-Do의 Board와 Task 상세, Comments·기록 복구, Mobile 메인·Sheet를 우선 부탁드립니다. 각 화면의 정상 상태뿐 아니라 읽기 전용, 빈 결과, Offline, 전송 대기와 실패 상태도 함께 필요합니다. Quick Capture와 Inbox는 임시 기록과 정리 기능으로 역할을 명확히 해서 별도로 다듬고 싶습니다. 저장 중에는 왼쪽 상단의 작은 회전 아이콘을 사용할 예정이므로 이 위치와 상세 상태 Popover도 공통 Component에 포함해주세요.
