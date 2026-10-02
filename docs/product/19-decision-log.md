# Decision Log

Status: Accepted Alpha specification

모든 아래 결정은 사용자의 구현 요청으로 Confirmed다. 원래 전체 범위의 후속 항목은 Deferred다.

| ID      | Topic         | Decision                                                      | Reason                   | Status    |
| ------- | ------------- | ------------------------------------------------------------- | ------------------------ | --------- |
| DEC-001 | Audience      | 개발자·일반 개인                                              | 사용자 답변              | Confirmed |
| DEC-002 | Personal/Team | 동일하게 중요                                                 | 사용자 답변              | Confirmed |
| DEC-003 | Positioning   | Notion 단계적 대체                                            | 사용자 답변              | Confirmed |
| DEC-004 | Core work     | 문서·지식 연결·기술 문서                                      | 사용자 답변              | Confirmed |
| DEC-005 | Release       | 핵심 Alpha 먼저                                               | 출시 범위 선택           | Confirmed |
| DEC-006 | Security      | Alpha 서버 평문 처리 가능                                     | E2EE 선택 답변           | Confirmed |
| DEC-007 | Markdown      | 입력 시 Block 변환                                            | 사용자 답변              | Confirmed |
| DEC-008 | Mobile        | 읽기·Capture·Comments                                         | 사용자 답변              | Confirmed |
| DEC-009 | Stack         | Next/React/TS/Fastify/Yjs/Hocuspocus/Dexie/Drizzle/PostgreSQL | 채택한 구현 기획         | Confirmed |
| DEC-010 | Ownership     | Recovery Key와 Device Key                                     | Accountless 복구         | Confirmed |
| DEC-011 | Scope         | Page/Database별 CRDT, 권한은 서버                             | 공유 경계 보호           | Confirmed |
| DEC-012 | Invite        | 7일/1회/기기 Identity Grant                                   | 제한된 초대              | Confirmed |
| DEC-013 | Task          | 고정 Property Table/Board, Row 본문                           | Alpha 구현 범위          | Confirmed |
| DEC-014 | Storage       | Local-first, DB Commit 후 Ack                                 | 손실 방지와 정직한 상태  | Confirmed |
| DEC-015 | Pairing       | Owner Recovery, 멤버 기기별 Identity                          | Alpha 복잡도 제한        | Confirmed |
| DEC-016 | Deferred      | Branch/Canvas/Public/Burn/Automation/고급 DB/Desktop          | 전체 범위 유지·단계 출시 | Deferred  |

## 구현 중 채택한 기본안

사용자 답변은 위 Confirmed로 유지한다. 아래는 승인된 Alpha의 범위 안에서 구현한 기본안이며 채택 근거를 기록한다.

| ID      | Decision                                           | Reason                                              | Status           |
| ------- | -------------------------------------------------- | --------------------------------------------------- | ---------------- |
| DEC-017 | 새 Page/프로젝트 Metadata 생성은 Owner             | Page 범위 초대를 넘어 새 권한 경계를 만들지 않음    | Accepted default |
| DEC-018 | Task 변환은 접근 가능한 프로젝트를 사용            | Row가 Database 권한을 상속함                        | Accepted default |
| DEC-019 | Task Table은 25 Rows Pagination                    | 1,000 Rows에서도 DOM 규모 제한                      | Accepted default |
| DEC-020 | Task Comments는 Database Page Thread               | 서버 Page 권한 경계를 그대로 사용                   | Accepted default |
| DEC-021 | Plain JSON Export v1, ID 재매핑과 새 Workspace     | 기존 Capability를 재생성하지 않고 데이터 이동       | Accepted default |
| DEC-022 | 읽기 전용 Replica도 PG Snapshot을 비교해 저장 확인 | 원격 Update 수신과 Durable 저장을 구분              | Accepted default |
| DEC-023 | E2E는 3002/3003과 별도 Build                       | 개발 Preview와 Offline 검증을 분리                  | Accepted default |
| DEC-024 | WSL Native PostgreSQL로 통합 검증                  | 현재 Docker 실행 경로가 끊겨 있어 독립 Cluster 사용 | Accepted default |

## 초대 Beta 결정

| ID      | Decision                                                               | Reason                                   | Status           |
| ------- | ---------------------------------------------------------------------- | ---------------------------------------- | ---------------- |
| DEC-025 | Vercel Hobby + Render Free + Neon Free, 5–10명 초대 Beta               | 사용자 무료 예산과 지정 플랫폼           | Confirmed        |
| DEC-026 | 신규 Workspace만 Beta 코드로 입장; 7일/1회/자격당 3개                  | 승인된 출시 계획, 소규모 운영            | Confirmed        |
| DEC-027 | Snapshot은 Owner만 사용하고 새 비공유 Root Page로 복구                 | 원본·링크·협업 상태 보호                 | Confirmed        |
| DEC-028 | 자동 기록 UTC 7일/최대 7개, 수동 최대 3개                              | 무료 저장 한도                           | Confirmed        |
| DEC-029 | 문서 Commit과 Checkpoint/로그 정리 Atomic 처리, Dedup Hash 유지        | 장애·재접속 시 데이터 보존               | Confirmed        |
| DEC-030 | Production/Preview 자동 배포 끄고 CI 후 Render → Vercel 수동 배포      | 계정/Schema/Origin 설정 검증             | Confirmed        |
| DEC-031 | 암호화 pg_dump + age, 배포 전/주 1회, 최근 4개                         | 승인된 수동 백업 운영                    | Confirmed        |
| DEC-032 | Alpha 코드 없는 Owner는 복구 가능; 새 생성 자격은 코드 발급            | 기존 사용자 데이터 보존과 Beta 입장 경계 | Accepted default |
| DEC-033 | 유휴 Polling 제거, Comment는 WS 변경 이벤트/Panel 재열기/명시 새로고침 | 무료 서버/DB 사용량 제한                 | Accepted default |

## 메인 UI 개편

| ID      | Decision                                                                      | Reason                                                | Status                |
| ------- | ----------------------------------------------------------------------------- | ----------------------------------------------------- | --------------------- |
| DEC-034 | 저장 알림바를 왼쪽 상단 회전 아이콘과 상세 Popover로 전환                     | 사용자 요청, 저장 중 문서 위치 유지                   | Confirmed             |
| DEC-035 | 제공된 Figma After의 Sidebar·좌측 정렬·Share/즐겨찾기/Page 메뉴 반영          | 사용자 제공 1차 시안                                  | Confirmed             |
| DEC-036 | Quick Capture·Inbox는 Workspace 전환 메뉴에 두고 Mobile Capture·Shortcut 유지 | 1차 시안의 주 메뉴 정리와 기존 Alpha 기능·데이터 보존 | Accepted default      |
| DEC-037 | 새 Workspace 기본 Task 이름 To-Do, 시작 문서 빈 본문; 기존 문서 보존          | 기능 역할을 명확히 하고 반복 소개 문구를 줄임         | Accepted default      |
| DEC-038 | 2차 디자인은 Share/권한 → Task 상세/Board → Comments/기록 → Mobile 우선       | 실제 Beta 협업 흐름의 미정 디자인 완성                | Proposed design scope |

### DEC-039 — 기능 체크리스트 P0와 기존 데이터 호환

Confirmed: 미구현 항목 확인 후 구현과 Production 배포까지 진행한다. Accepted: 체크리스트 P0의 남은 일반 Database 속성·Filter/Sort/Group·Calendar/Timeline/Gallery부터 구현한다. 기존 즐겨찾기·Quote/Divider·Snapshot 기록은 구현 증거에 따라 완료 상태를 바로잡는다.

Accepted: 기존 Task Row와 문서 API를 재사용하고 일반 Database 모드/속성/View를 Yjs에 추가한다. 기존 문서 자동 변환과 DB Migration은 하지 않는다. Snapshot은 확장 데이터를 새 문서에 복제한다. Gallery는 실제 속성 카드이며 Media 업로드는 후속이다. 날짜 계산은 날짜 전용 값이며 날짜 없는 Row를 숨기지 않는다.
