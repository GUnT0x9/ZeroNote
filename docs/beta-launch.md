# ZeroNote 초대 Beta 운영

2026-10-01. 배포 대상은 Vercel Hobby(Web), Render Free(REST/WebSocket), Neon Free(PostgreSQL 17)다. 초대 대상은 5–10명이며 유료 Upgrade와 자동 Production/Preview 배포를 사용하지 않는다. Vercel·Render·Neon 서비스를 생성하고 Production HTTPS 배포를 완료했다. 실제 기기의 Mobile 확인과 운영자 2명 시범 사용 후 초대 대상을 확대한다.

## 계정과 서비스 생성

1. Neon Free에서 PostgreSQL 17 프로젝트를 만들고 Render와 가까운 Region을 선택한다. TLS `sslmode=require`가 포함된 접속 URL을 Render의 Secret 환경변수로 등록한다. Web에는 DB URL을 제공하지 않는다.
2. GitHub 저장소 `GUnT0x9/ZeroNote`의 `main`에 `render.yaml`을 적용한다. `zeronote-api`는 Free, Singapore, 서버 전용 `Dockerfile.server`, 단일 인스턴스다. `WEB_ORIGIN`은 아래 Web의 고정 Production Origin으로 입력한다. `REALTIME_SECRET`은 Blueprint가 생성한다. Render가 제공하는 `PORT`로 HTTP와 WebSocket을 함께 받는다.
3. Vercel에서 저장소를 연결하고 Root Directory를 `apps/web`, Node.js를 24로 설정한다. Workspace 외부 소스 포함 옵션을 활성화한다. `ENABLE_EXPERIMENTAL_COREPACK=1`로 root packageManager의 pnpm 11.9.0을 사용한다. `apps/web/vercel.json`은 Git 자동 배포를 끈다.
4. Vercel Production에 `API_INTERNAL_ORIGIN=https://<render-service>.onrender.com`, `NEXT_PUBLIC_COLLABORATION_URL=wss://<render-service>.onrender.com/collaboration`, `NEXT_PUBLIC_BETA_REQUIRED=true`를 입력한다. 주소는 공개 설정이며 인증 Secret을 URL에 넣지 않는다. Preview에 Production 설정을 복사하지 않는다.
5. Render에 `NODE_ENV=production`, `BETA_REQUIRED=true`, `DATABASE_URL`, `WEB_ORIGIN=https://<project>.vercel.app`를 설정한다. Origin에 경로나 끝 `/`를 붙이지 않는다. Secret은 Dashboard/환경변수로만 관리한다.
6. CI가 통과한 Commit을 Render에서 먼저 수동 배포하고 `/v1/health`를 확인한 뒤 Vercel Production을 수동 배포한다. 아직 CI가 통과하지 않은 Commit을 승격하지 않는다.

처음 서비스를 만들 때 Render의 `WEB_ORIGIN`에는 사용할 Vercel 프로젝트의 예정 Production Origin을 입력한다. Vercel에서 실제 주소를 확인한 뒤 값이 다르면 Render 설정을 고치고 Render → Vercel 순서로 다시 배포한다. 운영 초대코드는 주소와 Origin을 확정한 뒤 발급한다. Vercel의 수동 배포는 Dashboard에서 CI가 통과한 Git Commit을 지정할 수 있다. [Vercel Deployment Methods](https://vercel.com/docs/deployments)

REST는 Web의 `/v1`에서 Render로 Rewrite한다. Domain 속성 없는 Session Cookie는 Web Origin에 귀속되며 Secure·HttpOnly·SameSite=Strict다. WebSocket은 Render로 직접 연결하고 REST에서 받은 5분 문서 범위 Token을 인증 Frame으로 보낸다. API는 `no-store`이며 SW가 Cache하지 않는다.

## Beta 코드와 사용자 진입

- Trigger: 새 Workspace/Import 시작. 처음 참여할 때 Online에서 `ZNB1-…` 코드를 입력한다. 승인 후에는 같은 기기에서 생략할 수 있다.
- Behavior: 코드 1회 수락, Hash 저장, 기본 7일 만료, 자격당 Workspace 3개. 수락한 코드 재시도는 같은 기기에 같은 자격을 반환한다. 소유 Workspace Recovery로 새 기기에 자격을 전달한다. Page 초대만 수락한 기기는 생성 자격을 받지 않는다.
- Offline: 이전에 승인된 Status를 Cache한 기기는 로컬 생성 가능하다. Online에서 자격/개수를 다시 확인한다. 거절된 Workspace의 내용과 Queue를 보존하고 Settings에서 Export한다.
- Error: 잘못된 형식 400, 코드 만료/다른 기기 사용 410, 이미 다른 자격/개수 초과 409, 미승인 403. 코드·Recovery Key·Cookie·Token은 로그에 넣지 않는다.
- Acceptance: 동시에 두 기기가 코드를 수락하면 한 기기만 성공한다. 코드 없이 기존 Page 초대·Recovery가 가능하다. Alpha 시절 코드 없는 Workspace는 복구되지만 신규 생성 자격은 Beta 코드를 별도로 받아야 한다.

운영 기기에서 저장소 밖의 새 파일로 발급한다. 출력 파일은 mode 0600이며 표준 출력에는 코드를 쓰지 않는다. 생성한 코드 파일을 Git이나 채팅에 붙이지 않는다.

```bash
# DATABASE_URL은 별도의 로컬 환경변수로 주입한다.
pnpm beta:issue /absolute/private/path/beta-codes.txt
```

## 기록과 복구

- Trigger: Owner가 Context Panel의 기록 탭을 연다. Trash에서도 기록을 열 수 있다.
- Behavior: 수동 생성 전 Local 저장과 서버 동기화를 끝낸다. 자동 기록은 문서가 바뀐 날의 첫 Commit에 생성한다. 날짜 기준은 UTC다. 자동 기록은 최근 7일/최대 7개, 수동 기록은 최대 3개이며 초과 시 명시적으로 삭제한다. 기록 조회/다음 Commit 때 만료 자동 기록을 정리한다.
- Offline: 기록 생성·조회·미리보기·복구·삭제는 Online에서 수행한다. 이미 표시된 미리보기는 읽기 전용이며 Offline에서 복구할 수 없다.
- Sync: Snapshot은 영속 저장된 Yjs 상태다. 미리보기는 원본 문서에 연결하지 않는다. 복구는 새 CRDT Identity와 Page ID로 Workspace 최상위에 비공유 Page를 만든다. Task Database는 Row와 Row 본문을 포함하며 날짜 전용 Due Date를 그대로 복제한다.
- Error: Owner 외 403, 미존재 404, 수동 개수/지원하지 않는 Version/Operation 충돌 409, 저장 공간 부족 507. 실패 시 원본과 기록은 유지한다.
- Acceptance: 자기 자신을 가리키는 Mention/Task Link는 새 Page ID로 변경하며 외부 링크는 유지한다. 하위 Page·Comments·Invite·Grant는 복사하지 않는다. 복구 Operation 재시도는 같은 새 Page를 반환한다.

## 저장과 장애

서버의 REST/WS 저장은 공통 transaction을 사용한다. 문서별 Lock, Operation Hash 확인, Update 적용/5MiB 제한, Checkpoint와 포함 위치 갱신, 제목 Projection, Update 로그 정리가 한 번에 Commit된다. WS는 실제 적용·Broadcast 전에 이 경로를 통과한다. 기존 Alpha Checkpoint는 Commit되지 않은 Room 변경을 포함할 수 있어 최초 Migration에서 폐기하고 저장된 Update에서 복원한다. Migration은 버전과 Advisory Lock으로 중복 실행하지 않는다.

Cold Start 연결 준비 대기는 90초, 일반 요청은 15초다. 읽기와 Operation ID를 포함한 요청만 일시적 502/503/504에서 최대 3번 재시도한다. Cookie 인증은 서버를 깨운 뒤 Challenge를 받아 만료 시간을 소비하지 않는다. 주기적인 Metadata/Comment 조회를 제거하고 Focus/재접속/실제 변경에서 동기화한다. Presence Heartbeat는 메모리에서 처리하고 문서 읽기·쓰기에서 서버 권한을 재검사한다. 권한 철회 시 활성 연결도 종료한다. Comment 목록은 서버의 Page 범위 WS 변경 이벤트, Panel 재열기/새로고침으로 갱신한다.

DB 200MiB부터 경고, 300MiB부터 새 문서·Page·Workspace·Comment·Invite·Snapshot 저장을 보류한다. 읽기·Export·권한 철회·복구 인증은 유지한다. 플랫폼 사용량은 운영자가 Dashboard에서 확인한다. `pg_database_size`는 Neon 청구 저장량과 동일한 지표가 아니며 별도로 확인해야 한다. 삭제만으로 파일 크기가 즉시 줄지 않을 수 있다. 한도에 접근하면 Export/암호화 백업 후 유지보수 시간에 DBA 검토 하에 공간 정리 또는 별도 새 DB로 복원한다. 자동 유료 전환은 하지 않는다.

## 암호화 백업과 복원

Linux/WSL 운영 환경에 Node.js 24, PostgreSQL 17 client와 `age`를 준비한다. Private Key와 백업은 저장소 밖에 둔다. Script는 저장소 내부의 백업/복호화 Key 경로를 거절한다. PostgreSQL Client에는 비밀번호를 제거한 URL을 전달하고 임시 0600 Password File을 사용한다. TLS 연결 옵션을 유지하며 종료 후 임시 파일을 정리한다. 백업은 배포 전과 주 1회 운영자가 실행한다. 최근 정상 백업 4개를 유지한다. Snapshot은 재해 복구 백업을 대신하지 않는다.

```bash
age-keygen -o /absolute/private/path/backup.agekey
export AGE_RECIPIENT="$(age-keygen -y /absolute/private/path/backup.agekey)"
export BACKUP_DIRECTORY=/absolute/private/path/backups
pnpm backup

# 빈 별도 DB에만 복원하며 원본 DB에 실행하지 않는다.
export RESTORE_DATABASE_URL='<separate empty database connection URL>'
export AGE_IDENTITY_FILE=/absolute/private/path/backup.agekey
export BACKUP_FILE=/absolute/private/path/backups/zeronote-<timestamp>.age
pnpm restore
```

DB 백업에는 서버 인증 Hash와 Membership도 포함되므로 암호화 파일로만 보관한다. Workspace Export는 사용자 데이터 이전용이며 인증 Secret을 제외한다. `restore`는 비어 있지 않은 DB와 원본과 같은 URL을 거절하고 하나의 Transaction으로 복원한다. CI는 별도 DB에서 암호화·복원, Migration 개수, 주요 테이블의 행 수와 전체 내용 일치를 검사한다. 실제 Production 백업도 공개 전에 별도 DB로 복원하고 문서/Task/권한을 Smoke Test한다.

## 공개·Roll Back

1. 실제 HTTPS에서 Cookie, Origin, REST, WSS, Viewer/Commenter 쓰기 차단, Offline 새로고침·재접속 병합, Recovery, 기록 복구를 확인한다.
2. 실제 Android Chrome/iOS Safari에서 읽기·Capture·Comments·Keyboard Focus를 확인한다. 자동 Chromium 검증과 별도 기록한다.
3. 운영자 2명에게 코드 발급 → 문제 없으면 5–10명에게 확대한다. 연락 수단과 피드백 수집은 운영자가 직접 진행한다.
4. 문제 발생 시 코드 추가 발급을 중단하고 마지막 호환 앱 버전을 재배포한다. DB Down Migration과 자동 데이터 Rollback을 실행하지 않는다. 이전 Alpha 저장 서버는 Beta의 정리된 로그/Checkpoint 구조와 호환되지 않아 그대로 Roll Back하지 않는다. Web 직전 버전은 `/v1` 기존 API와 호환된다.

## 배포 기록

| 항목                 | 현재 상태                                                                                             |
| -------------------- | ----------------------------------------------------------------------------------------------------- |
| Vercel Production    | https://zeronote-kohl.vercel.app · Hobby · Node.js 24                                                 |
| Render API/WSS       | https://zeronote-api.onrender.com · `/collaboration` · Free · Singapore                               |
| Render Service       | `srv-dauvutk1nsns73fvhmp0` · 단일 인스턴스 · 자동 배포/Preview 꺼짐                                   |
| Neon                 | `zeronote-beta` / `mute-frost-94656200` · Free · PostgreSQL 17 · Singapore                            |
| Neon DB              | `zeronote` · 복원 검증용 별도 DB `zeronote_restore`                                                   |
| 실제 HTTPS           | Web/API 200, 잘못된 Origin 403, Web 도메인의 Secure·HttpOnly·SameSite=Strict Cookie 확인              |
| Production 백업/복원 | pg_dump 17.11 + age 1.3.2 · 별도 `zeronote_restore` DB · 10개 테이블 내용 일치 및 문서/Task/권한 확인 |
| 실제 Mobile 기기     | Android Chrome/iOS Safari에서 수동 확인 필요                                                          |

실제 Production HTTPS에서 Browser 8개 시나리오를 통과했고, 서버 재시작 후 새 브라우저 Recovery와 문서·Task·Comments·기록·기존 Viewer 권한 유지도 확인했다. 운영용 일회성 초대코드 10개는 2026-10-01 발급했으며 7일 뒤 만료한다. 먼저 운영자 2명에게 사용하고 실제 Android/iOS 및 Sleep 이후 연결 상태를 확인한 뒤 5–10명으로 확대한다.

현재 Render는 `codex/remaining-features` Branch를 사용한다. Vercel은 CI 통과한 Commit Archive를 CLI로 수동 업로드한다. PR 병합 후 Render의 Branch를 `main`으로 바꾸고 같은 순서로 배포한다. DB Schema는 되감지 않는다.

Render Free의 512MiB 제한에서 첫 배포가 실패했다. 원인은 Runtime의 `pnpm start`가 다시 전체 Workspace 의존성을 설치한 것이었다. `Dockerfile.server`에서 설치된 Loader로 Node.js를 직접 실행하도록 수정했고, CI에 512MiB Container 시작/Health 검증을 추가했다. 서버가 Ready가 된 뒤 Vercel을 배포했다.

운영 코드·Recovery Key·DB URL·복호화 Key·브라우저 인증 상태는 저장소 밖의 Private 디렉터리에만 보관한다. 발급한 코드 파일을 운영자가 개별 전달하며 추가 공개와 유료 전환은 자동으로 하지 않는다.

공식 설정 참고: [Vercel Git 설정](https://vercel.com/docs/project-configuration/git-configuration), [Render Blueprint](https://render.com/docs/blueprint-spec), [Render Free](https://render.com/docs/free), [age](https://github.com/FiloSottile/age).

구현 및 자동 검증 결과: [Beta 검증 기록](beta-validation.md).

### 2026-10-02 P0 Database/메인 UI 배포

`4b07123`의 CI 통과 후 Render `dep-davg5gtg1s2s73acvs20` → Vercel `dpl_ANsVUuXFkgjcgq9Phb99gYh8Eggd` 순서로 배포했다. 제공 도메인과 Secret은 유지했고 Render 자동 배포는 꺼져 있다. 일반 Database 속성·Saved View·Calendar/Timeline/Gallery/List과 이전 Figma 메인/상단 저장 아이콘 개편을 포함한다. Production 11개 흐름과 기존 데이터/Recovery/권한을 확인했다. 앱 소스와 검증/미실행 항목은 [Database 배포 기록](database-release.md)을 따른다.

2026-10-02 현재 Render 수동 배포 Branch는 `codex/remaining-features`이며 Auto Deploy는 꺼져 있다. 파일·Editor 확장의 현재 배포 Commit/검증/호환 Rollback은 [배포 기록](editor-files-release.md)을 따른다.

### 2026-10-06 Public Sharing 배포

현재 앱 소스는 `0b25956`이다. CI 통과와 암호화 Production 백업 후 Render `dep-db24f297lnhs73dil1b0` → Vercel `dpl_C3dsc4kk4tMRWAxDVVsSVygQ4ojf` 순서로 배포했고 Migration 006, Source SHA, Production Alias를 확인했다. 실제 HTTPS Browser 6개 및 4MiB Private/Public 다운로드·Range·새 기기 Recovery·Offline PDF를 통과했다. 보호 링크, 최초 Burn 내용, 선택 Scope, 공개 SEO와 검증/미실행 범위는 [Public Sharing 기록](public-sharing-release.md)을 따른다.

2026-10-06 Page Tags 운영 반영: `a09db74`, Render `dep-db29m26i0phs73ds9ugg`, Vercel `dpl_3KJzvYVinwygVggB2cesAZkhAsMy`. Migration 8개와 Protocol 1–4/source Index 누락 0건, CI 394 Tests/24 E2E/Docker/512MiB/암호화 복원 및 실제 HTTPS 3개 흐름을 확인했다. [Tag 출시 기록](tags-release.md). 전체 45/148 완료·103개 계속 개발.
