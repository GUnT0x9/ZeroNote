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

### DEC-045 — Database 의존 값과 호환성

Confirmed: 전체 미완료 범위의 File Property/Formula/Relation/Rollup을 구현·배포한다. Adopted: Property/Row/Database의 안정적인 ID를 저장하고 Formula AST와 Rollup 정의만 편집 원본으로 유지한다. 의존 값은 현재 요청자의 접근 가능한 대상에서 계산한다. 접근 철회/삭제가 서버에서 확인되면 캐시된 관계 이름과 이전 계산을 제외하며 미전송 데이터는 보존한다. Hocuspocus 인증 실패뿐 아니라 문서 Close에서도 REST로 상태를 확인하며 정상 종료/503/Offline을 권한 철회로 추측하지 않는다.

새 Property를 모르는 Editor의 데이터 손실을 막기 위해 Protocol 3과 Migration 007을 적용한다. 기존 Block/Attachment의 Protocol 1/2를 유지한다. File 참조는 현재 Row·Row 본문·Trash·Snapshot과 Public Scope의 보호에 포함한다. Snapshot은 외부 Database의 과거 내용을 복사하지 않고 현재 허용된 값으로 계산한다. Public Projection은 게시되지 않은 관계 대상과 Person/비공개 파생 값을 제외한다.

Verified 2026-10-06: `f7b4c00` CI 343 Tests/23 E2E/Docker/512MiB/암호화 복원과 Production Migration 7개, Render → Vercel 소스 일치, 실제 HTTPS 협업/Recovery와 속성/Offline/권한 철회/Snapshot을 확인했다. [출시 기록](../database-advanced-release.md)에 따라 44/148 완료, 104개는 계속 구현한다.

### DEC-046 — Page Tag와 검색 source Index

Confirmed: 남은 전체 체크리스트의 Tag와 검색·Knowledge 요구를 구현·배포한다. Adopted: Tag는 Page의 Yjs Map에 표시 이름과 NFKC/공백/대소문자를 정리한 Key로 저장한다. Page의 권한을 상속하며 기본 한도는 30개·각 64자다. 동시 추가로 한도를 초과하면 로컬 목록을 유지하고 제거 후 다시 저장할 수 있다. 복제/Export/Import/Snapshot에 포함하고 마지막 제거 이후에도 Editor Protocol 4 경계를 유지한다.

Migration 008의 source Index는 Commit·Checkpoint와 같은 transaction에 저장하며 과거 삭제 Row/속성과 요청별 Relation 이름·Formula/Rollup 결과를 보관하지 않는다. Ready 전에 Page lock으로 기존 committed state를 읽어 한 번 생성한다. 접근 가능한 문서 목록에는 보이지 않는 부모의 Trash 상태만 파생 boolean으로 전달하며 부모 내용을 노출하지 않는다. 기존 로컬 검색/탐색에서도 제외한다. 검색 API/UI·Graph·추천은 별도 미완료 항목으로 유지하고 실제 배포 검증 뒤 완료 수를 기록한다.

Verified 2026-10-06: `a09db74`의 CI 394 Tests/24 E2E/Docker/512MiB/8개 Migration/암호화 복원, Render → Vercel의 같은 소스 배포와 실제 HTTPS Tag/협업/Recovery/Database를 확인했다. [Tag 출시 기록](../tags-release.md)에 따라 45/148 완료·103개 계속 개발이다.

### DEC-047 — 전체 검색과 일시적인 Local source overlay

Confirmed: Global Search·필터/속성·오타·연산자를 배포하고 Offline 변경을 보존한다. Adopted: 같은 공유 matcher를 서버의 committed source Index와 기기의 저장된 문서에 사용한다. 첫 기본 범위는 현재 Workspace이며 전체 범위를 선택할 수 있다. 서버 검색은 전체 문서 본문을 기기로 내려받지 않고 결과를 반환한다. 본문은 열 때 저장하고 Offline 검색 범위를 표시한다.

검색 중 미전송 source는 최대 32개 overlay로 요청 안에서만 적용한다. 요청자의 편집 권한을 확인하며 Index/CRDT를 수정하지 않는다. Computed 값·Relation/File/Person 이름은 요청자의 접근 가능한 같은 Workspace 범위로 읽는다. clean 로컬 결과로 서버 non-match를 다시 추가하지 않으며 아직 등록 대기 중인 새 Page는 로컬로 포함한다. 문법·UI 조건은 공유 AST로 검증하고 날짜 필터는 UTC 수정일(after 이상/before 미만)로 고정한다. 오타 비교는 짧은 문자 단어의 한 번 편집만 허용하며 정확/구문/제외어/숫자의 의미를 변경하지 않는다.

검색은 8 Page batch·source 16MiB·동시 2개로 제한하고 범위 축소 오류와 로컬 대체 결과를 표시한다. 이전 요청은 취소하고 Search POST에만 읽기 재시도를 허용한다. [검증/배포 기록](../search-release.md); Production 확인 전에는 완료 수를 올리지 않는다.

Verified 2026-10-07: DEC-047의 검색 5개를 `15f2036`으로 배포하고 CI 420 Tests/25 E2E/Docker/512MiB/백업 복원 및 실제 HTTPS 3개 흐름을 확인했다. 50/148 완료·98개 남음이다. [출시 기록](../search-release.md).

### DEC-048 — 접근 범위의 Graph·관련 문서·링크 상태

Confirmed: Knowledge Graph·Related Pages·Broken Link와 전체 Backlinks를 실제 UI에서 제공한다. Adopted: 기존 committed source Index에서 본문 전체/CRDT 이력 대신 제한된 연결·Tag·활성 Row 이름·단어 head를 읽고, 서버가 확인한 Metadata/Grant 범위로 같은 공유 계산을 적용한다. Editor/Owner의 Dirty Overlay는 요청 안에서만 적용하며 제목도 반영한다. Graph는 Page/Database Node로 Row 연결을 묶고 200 Node·800 Edge·목록/키보드/Touch 탐색을 제공한다. 관련 문서는 같은 Workspace의 연결·Tag·본문 단어 근거를 표시한다.

접근 확인 불가와 알려진 Trash/삭제 Row를 구분한다. 숨겨진 대상의 존재/삭제/이름을 조회하지 않는다. Mention/Task Link는 선택한 본문의 같은 대상 링크를 함께 교체하고 Relation은 명시적으로 고른 한 Property의 Row 참조만 교체한다. 동시 변경·삭제·권한을 재검사하고 저장 실패를 성공으로 표시하지 않는다. 독립된 하위 Page Grant는 부모 접근 철회로 소멸하지 않으며 부모 Trash는 하위 Page에 적용한다. 서버 head 조회는 8 Page batch·16MiB·동시 2개 제한이며 유휴 Polling이나 인증 응답 영속 Cache를 추가하지 않는다.

Verified 2026-10-07: `34bc93e`의 CI 440 Tests/26 E2E/Docker/512MiB/암호화 복원, Render → Vercel과 실제 HTTPS 5개 흐름을 확인했다. [출시 기록](../knowledge-release.md). 53/148 완료·95개 남음이다. 다음 Task 5개의 구현 기본안은 [Task 확장 기준](../task-extension-plan.md)에 기록했으며 구현 전에는 완료로 집계하지 않는다.
