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

### DEC-040 — 전체 미완료 항목 완료 목표

Confirmed: 사용자가 P4 언급을 정정하고 체크되지 않은 모든 기능 구현·배포를 요청했다. 우선순위는 실행 순서이며 제외 범위가 아니다. 148개 요구를 `docs/full-completion.md`에서 실제 구현과 검증 증거로 추적하고 전체 완료 전 goal을 종료하지 않는다.

### DEC-041 — 파일 기반과 Editor 호환성

Accepted: 무료 Beta는 PostgreSQL Bytea에 파일을 저장하고 4MiB/파일, Workspace 25MiB/200개와 서버 용량 한도를 적용한다. 로컬 bytes/Hash/Operation ID를 먼저 저장한다. 파일은 Page 권한을 상속하고 Snapshot/Page 복제는 새 파일 ID로 복사한다. Export version 2에 참조 파일을 포함하고 기존 version 1 Import를 유지한다. 파일 삭제는 Snapshot 복구용 bytes를 보존한다. Storage 관리 UI/영구 정리는 별도 요구로 남는다.

Accepted: 새 Block을 이해하지 못하는 구버전 Yjs Editor의 삭제를 막기 위해 Editor Protocol 2와 서버 Checkpoint 최소 버전을 사용한다. 새 기능 방송 전에 구버전 연결을 종료하고 REST/WS/Snapshot에서 426으로 앱 새로고침을 안내한다. 기존 Block 문서는 버전 1을 허용한다. 파일/PDF/Template/Command/Mobile Editor 구현과 검증은 `docs/editor-files-release.md`를 따른다.

## DEC-042 · 데이터 이전 형식과 암호화 백업

사용자가 Confirmed한 전체 미완료 범위에서 JSON/ZIP은 Yjs와 첨부를 보존하는 복원 형식으로 제공한다. Markdown/HTML/PDF/Notion Markdown & CSV는 공유·이전 형식으로 추가한다. Notion/Obsidian 가져오기는 ZIP의 Markdown/CSV/참조 첨부, 안정적인 새 Page ID와 Row 본문을 복원한다. HTML 구문은 실행하지 않고 원문으로, Table은 현재 Editor에서 셀 값을 텍스트 표로 보존하며 변환 내용을 가져오기 전에 표시한다. CSV에는 원본의 Formula/Relation 정의·권한 정보가 없으므로 값을 text 속성으로 복원한다.

암호화 Export는 기기에서 PBKDF2-SHA-256 600,000회·32-byte Salt·AES-256-GCM·12-byte IV를 사용한다. 암호·Recovery·초대·인증 정보는 보관/전송하지 않는다. 이는 선택형 E2EE의 완료를 의미하지 않는다. E2EE와 기기 Pairing은 별도 미완료 요구다. Import는 로컬 transaction 실패 시 부분 Workspace/Queue를 남기지 않는다.

## DEC-043 · Storage 관리와 영구 정리

사용자가 Confirmed한 Storage 관리 요구를 Settings의 저장 공간 화면에서 제공한다. 서버의 전체 파일 사용량과 이 기기의 사본·미전송/보존 파일을 구분한다. 서버 파일 정리는 Online Workspace Owner만 수행하며 현재 문서·Trash·유효 Snapshot의 참조가 있으면 거절한다. 정리 성공 후에도 ID·Hash·Operation은 Tombstone으로 유지해 중복 Upload로 파일이 살아나지 않게 한다. 파일 사본 제거는 접근 철회·Trash·미전송/보존 파일을 유지한다. REST/WS Commit은 정리된 파일을 참조한 내용을 수락하지 않고 로컬 변경을 보존한다.

Migration 005 이후 Server rollback은 Tombstone과 422 문서 검증을 이해하는 버전을 사용한다. DB를 되감거나 영구 정리한 bytes를 자동 복원하지 않는다. 일반 파일 삭제는 계속 Snapshot용 bytes를 보존한다.

### DEC-044 — 선택형 Public 게시와 첫 Session 내용 고정

Confirmed: 기존 체크리스트의 미완료 Public Page/Password/Temporary/Burn/Expiring/Public Workspace/SEO를 실제 UI·서버 저장·배포까지 구현한다. Workspace Owner가 고른 Page만 게시하며 Parent/새 Page/Comments/권한/Identity/과거 삭제 내용은 자동 공개하지 않는다. 원본 CRDT 대신 현재 내용의 Allowlist HTML Projection과 불투명 Page Key를 제공한다. Database는 활성 Row와 일반 Property/본문을 공개하고 Person Property는 제외한다.

Adopted: 기본 noindex이며 보호되지 않은 Public 링크에서만 SEO를 opt-in한다. 보호된 링크의 256bit Secret은 URL Fragment에 담고 Hash만 저장한다. 비밀번호는 Salt/scrypt Hash, 읽기 권한은 별도 Cookie Session으로 관리한다. Burn은 명시적 POST의 첫 Session만 Transaction으로 승인하고 최초 내용/파일 참조를 고정한다. 같은 Operation/Reader의 재시도는 같은 Session을 받는다. 읽기 시간은 Burn 최대 1시간, 다른 보호된 링크 최대 24시간이며 링크의 만료/해제/Trash/파일 삭제가 이후 접근을 제한한다. 전달된 사본을 회수한다고 설명하지 않는다. 현재 참조 또는 유효한 Burn 읽기가 필요한 파일은 Storage 정리에서 보존한다. 주기적인 서버/DB Keep-alive는 추가하지 않는다.

기존 Alpha/Beta API와 Editor Protocol 2를 유지하는 Migration 006 추가로 배포한다. 익명 `/s/` 화면은 Device·개인 Workspace·IndexedDB·Editor·WebSocket을 만들지 않는다. Scope·권한·Race·과거 내용 비노출·브라우저와 실제 HTTPS 결과를 출시 기록에 남긴 뒤 완료 항목에 반영한다.

Verified 2026-10-06: `0b25956`의 CI 212 Tests/22 E2E/Docker/512MiB/암호화 백업 복원과 Render → Vercel 배포, 실제 HTTPS 6개 흐름 및 4MiB Public/Private/Range/Recovery/Offline PDF를 확인했다. 기록은 `docs/public-sharing-release.md`에 남기며 전체 목표는 40/148 완료, 108개 계속 개발이다.
