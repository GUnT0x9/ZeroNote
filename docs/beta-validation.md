# ZeroNote 초대 Beta 검증

검증일: 2026-10-01. Beta 코드·저장 안정화·Snapshot·배포 구성을 구현했다. Vercel Hobby·Render Free·Neon Free에 실제 HTTPS로 배포했다. 서비스 설정과 공개 전 확인은 [운영 문서](beta-launch.md)에 정리했다.

## 실행 결과

| 검증                                                                   | 결과                                                                           |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `pnpm lint`                                                            | 통과                                                                           |
| `pnpm type-check`                                                      | Web/Server/Shared/Browser 테스트 통과                                          |
| `pnpm test`                                                            | 11개 파일, 93개 테스트 통과                                                    |
| `pnpm test:e2e`                                                        | Production Build와 필수 Beta 코드 환경에서 Chromium 8개 시나리오 통과          |
| `pnpm build`                                                           | Web Production Build와 Server TypeScript 통과                                  |
| PostgreSQL 17, 서버 Docker Build/512MiB 시작, 암호화 백업/별도 DB 복원 | [GitHub CI](https://github.com/GUnT0x9/ZeroNote/actions/runs/36829053133) 통과 |

로컬 환경은 Node.js 24.14.1, pnpm 11.9.0, PostgreSQL 14.24다. 로컬 Docker 실행 경로가 끊겨 있어 Docker Image 검증은 CI에서 수행한다. 운영 백업용 PostgreSQL 17.11 Client와 age 1.3.2를 별도로 설치하여 Neon Production의 암호화 백업과 별도 DB 복원을 수행한다. Browser 테스트는 실제 운영 CLI로 발급한 코드를 사용한다. 코드가 없는 Page 초대와 새 기기 Recovery도 함께 검증했다.

CI는 백업을 5번 생성해 암호화 파일 4개 보관을 확인하고, 별도 빈 DB로 복원한 뒤 Migration 2개를 확인했다. 저장소 내부 백업 경로와 비어 있지 않은 복원 대상도 거절했다. 추가로 주요 10개 테이블의 행 수와 전체 내용 Digest를 원본/복원 DB 사이에서 비교한다. 비교 대상은 Workspace·Page·CRDT Checkpoint·Operation·Snapshot·Membership·Grant·Comment·Beta 자격이며 Secret이나 원문 데이터는 로그에 출력하지 않는다.

## 실제 배포와 백업

Production은 [ZeroNote Beta](https://zeronote-kohl.vercel.app), API는 `https://zeronote-api.onrender.com`이다. `codex/beta-release`의 CI 통과 Commit `9278b14`를 Render → Vercel 순서로 수동 배포했다. REST Rewrite와 잘못된 Origin의 403, WebSocket Origin 거절을 확인했다. Render Free 첫 배포의 Runtime 의존성 재설치/OOM을 Node 직접 실행으로 해결하고 512MiB 시작 검증을 CI에 추가했다.

실제 Neon PostgreSQL 17의 `zeronote`를 pg_dump 17.11 + age 1.3.2로 암호화하고 빈 `zeronote_restore` DB에 Transaction으로 복원했다. 원본/복원 사이 주요 10개 테이블의 전체 내용 Digest가 일치했다. 검증용 데이터에는 문서 본문·Task의 `in_progress` Status·Viewer Grant·Comment·수동 Snapshot이 들어 있으며, 두 DB에서 CRDT를 읽어 본문과 Task 값을 확인했다. 복호화 Key, 인증 정보, 사용자 내용은 Git에 기록하지 않았다.

| 복원 비교 대상                          | 행 수          |
| --------------------------------------- | -------------- |
| Workspace / Page                        | 3 / 9          |
| Document Checkpoint / Operation         | 9 / 16         |
| Snapshot / Membership / Grant / Comment | 10 / 5 / 2 / 1 |
| Beta Code / 승인 기기                   | 90 / 9         |

이 행 수는 백업 시점의 QA 데이터이며 이후 테스트/초대코드 발급으로 바뀔 수 있다. 자동 테스트가 만든 Workspace는 정리하고, 서버 재시작 확인용 Workspace 하나는 Private Recovery Key로 관리한다.

실제 HTTPS에서도 Chromium 8개 시나리오가 모두 통과했다(2.1분). 초대 수락 직전의 초기 동기화가 완료되기만 기다려 새 Grant를 놓치는 Production Latency 문제를 발견했고, 후속 요청을 병합해 다시 실행하도록 수정했다. 초대·실시간 공동 편집·Comments·Viewer·코드 없는 Recovery를 재검증했다.

Render를 실제 재배포/재시작한 뒤 별도 새 브라우저에서 Private Recovery Key로 같은 Workspace를 복구했다. 문서 본문·Task Status·Comments·수동 Snapshot을 확인했고, 재시작 전에 수락한 Viewer의 기존 Cookie로 Metadata 권한 유지와 본문 쓰기/기록 조회의 403을 확인했다. Playwright의 IndexedDB 상태 복사는 CryptoKey를 재구성하지 못해 이 확인에서는 기존 Cookie와 REST를 사용했다. 실제 새 기기 Recovery는 빈 브라우저에서 검증했다.

Vercel CLI는 `.gitignore`의 Browser 결과 디렉터리를 기본 제외하지 않았다. `.vercelignore`를 추가해 `test-results`·`playwright-report`·환경변수·Key·코드 파일을 제외했다. `vercel deploy --dry --json`으로 보고서와 Private 설정이 없는 업로드 목록을 확인했다.

## 회귀 방지 근거

- Beta: 동시 일회성 코드 수락, 같은 기기의 재시도, 만료/재사용 거절, Workspace 3개 제한, 같은 Workspace 동시 생성, Recovery 자격 상속, 코드 없는 Page 초대.
- 저장: 기존 Alpha 데이터의 Migration, 반복 Migration, 더러운 옛 Checkpoint 제외, Commit/Checkpoint 실패 시 Rollback, 로그 정리 후 재시작, 정리된 Operation 재전송과 Payload 충돌, 누적 5MiB 제한, 용량 초과 시 기존 데이터 보존.
- 협업: 실제 WebSocket 5명 동시 편집, Offline 병합, 원격 변경을 유지하는 Undo, Viewer/Commenter 쓰기 차단, 검증된 Presence Identity, Presence Heartbeat의 DB 권한 조회 제거.
- 기록: 불변 Snapshot, 하루 첫 Commit의 자동 기록, 자동 만료/삭제, 수동 3개 제한, Owner 외 거절, 읽기 전용 미리보기, Task Row/본문 복구, 자기 참조 재매핑, Trash 복구, 비공유 Root Page 생성, 복구 Operation 재시도.
- 연결/Local: 동기화 도중 초대 수락 시 후속 동기화를 기다려 새 Grant를 조회하는 회귀 검증 4개, HTML 오류 응답, 일반/Cold Start Timeout, 안전한 작업만 재시도, Offline 승인 Cache, 저장 공간 부족과 접근 철회 후 로컬 보존, Offline 새로고침/재접속.
- Mobile/이전: Chromium Touch Viewport의 읽기·Capture·Comments·Focus, Export/Import 문서·Task·링크 보존 및 Secret 제외.

## 성능

동일한 캐시 데이터인 1,000 Pages, 500 Blocks 문서, 1,000 Task Rows로 측정했다. 성능 Threshold는 완화하지 않았다.

| 지표           | 로컬 Beta | 실제 HTTPS Beta | 목표         |
| -------------- | --------- | --------------- | ------------ |
| 캐시 문서 열기 | 447.6ms   | 170.3ms         | 1,000ms 미만 |
| Local Search   | 109.7ms   | 95.0ms          | 200ms 미만   |

Page/Document 중첩 탐색을 Set으로 바꾸고 변경 없는 캐시 문서의 Projection 재저장을 제거했다. IndexedDB에만 남은 최신 변경은 새 Generation으로 표시하여 서버 저장 완료로 오인하지 않으며 두 회귀 테스트로 검증했다.

측정은 Browser 안의 입력부터 렌더 완료 후 두 번째 Animation Frame까지다. 원시 수치는 [로컬 측정](beta-performance.json)과 [HTTPS 측정](beta-production-performance.json)에 있다. 단일 Headless 실행 수치이며 운영 기기/실제 Cold Start 성능을 보장하는 값은 아니다.

## 공개 전 남은 검증

- Render Sleep 이후 실제 Cold Start 대기 시간과 동기화 상태.
- 실제 Android Chrome/iOS Safari의 읽기·Capture·Comments·Keyboard Focus.
- 운영자 2명 사용 후 5–10명으로 확대.

## 변경 파일과 이유

아래 목록은 Beta 변경 파일이다. Alpha 구현 기록은 [validation.md](validation.md)에 보존했다.

| 파일                                                | 변경 이유                                                               |
| --------------------------------------------------- | ----------------------------------------------------------------------- |
| `.dockerignore`                                     | Docker Context에서 Secret과 백업 제외                                   |
| `.env.example`                                      | Vercel/Render/Beta 환경변수 설정 예시                                   |
| `.github/workflows/ci.yml`                          | PostgreSQL 17, 서버 Docker, 암호화 백업/복원 검증                       |
| `.vercelignore`                                     | Vercel 업로드에서 Browser 결과/환경변수/Private Key·코드 제외           |
| `.gitignore`                                        | 배포 연결 파일과 코드/백업/복호화 Key 제외                              |
| `Dockerfile.server`                                 | Render에서 서버만 실행하는 Node 24 이미지                               |
| `README.md`                                         | Beta 실행 범위와 운영/검증 안내                                         |
| `apps/server/package.json`                          | 운영자 전용 Beta 코드 발급 명령                                         |
| `apps/server/src/app.ts`                            | 공유 문서 Service, 인증 API no-store, 전송 Frame 한도                   |
| `apps/server/src/beta-cli.ts`                       | Hash만 저장하는 일회성 코드 10개를 저장소 밖에 발급                     |
| `apps/server/src/beta.test.ts`                      | 초대코드/자격/기록/로그 정리/용량의 정상과 실패 검증                    |
| `apps/server/src/database/beta-store.ts`            | 동시 코드 수락과 자격당 Workspace 제한                                  |
| `apps/server/src/database/document-store.ts`        | Commit/Checkpoint/로그 정리/Operation Hash/용량 처리                    |
| `apps/server/src/database/migrations.ts`            | 버전별 Migration과 중복 실행 Lock                                       |
| `apps/server/src/database/migrations/001-alpha.sql` | 기존 Alpha Schema를 첫 Migration으로 보존                               |
| `apps/server/src/database/migrations/002-beta.sql`  | Beta 자격/Checkpoint 위치/Operation/Snapshot Schema                     |
| `apps/server/src/database/repository.ts`            | Migration/새 Store 연결과 생성 제한/Recovery 자격 상속                  |
| `apps/server/src/database/snapshot-store.ts`        | 기록 보관/중복 처리/새 비공유 Page 복제                                 |
| `apps/server/src/env.ts`                            | Render PORT, Production 필수 Secret/HTTPS/TLS 검증                      |
| `apps/server/src/errors.ts`                         | Repository와 Service의 공통 DomainError                                 |
| `apps/server/src/migrations.test.ts`                | 기존 Alpha 데이터 보존과 Migration 중복 실행 검증                       |
| `apps/server/src/realtime.test.ts`                  | Presence의 메모리 처리와 문서 권한 재검사 검증                          |
| `apps/server/src/realtime.ts`                       | WS 적용 전에 Commit/한도 검사, Presence DB Polling 제거                 |
| `apps/server/src/routes.ts`                         | Beta/기록/용량 API와 Comment 변경 이벤트                                |
| `apps/server/src/services.ts`                       | 문서 Commit을 원자적인 Repository 저장으로 통합                         |
| `apps/server/src/snapshot-service.ts`               | Owner 전용 기록과 Trash 복구 권한/Version 검사                          |
| `apps/web/env.config.ts`                            | Web Build의 API/Collaboration 공개 설정 검증                            |
| `apps/web/next.config.ts`                           | 검증된 Render Origin으로 기존 REST Rewrite 연결                         |
| `apps/web/src/app/globals.css`                      | 기록 목록/미리보기 UI 스타일                                            |
| `apps/web/src/components/block-editor.tsx`          | 로컬 저장 Provider 없이 읽기 전용 기록 렌더                             |
| `apps/web/src/components/context-panel.tsx`         | 기록 탭과 이벤트 기반 Comment 갱신                                      |
| `apps/web/src/components/dialogs.tsx`               | Beta 코드 수락과 Recovery 자격 Cache                                    |
| `apps/web/src/components/document-view.tsx`         | Owner 기록 버튼과 Visible 재접속                                        |
| `apps/web/src/components/history-panel.tsx`         | 기록 생성/조회/삭제/미리보기/새 Page 복구                               |
| `apps/web/src/components/sidebar.tsx`               | Beta 환경의 제품 표시                                                   |
| `apps/web/src/components/workspace-app.tsx`         | 연결 준비/서버 용량/생성 거절 상태와 Trash 기록                         |
| `apps/web/src/lib/api.ts`                           | Cold Start 준비 후 Device Challenge와 요청 처리 통합                    |
| `apps/web/src/lib/beta.test.ts`                     | 승인 Cache/미승인/개수 제한/수락 응답 검증                              |
| `apps/web/src/lib/beta.ts`                          | 승인 Status Cache와 Offline Workspace 제한                              |
| `apps/web/src/lib/database.ts`                      | 거절된 로컬 Workspace의 오류 보존                                       |
| `apps/web/src/lib/documents.ts`                     | 직접 WSS, Comment 이벤트, Background 연결 해제                          |
| `apps/web/src/lib/env.test.ts`                      | 기본/외부 WSS URL 생성과 잘못된 설정 검증                               |
| `apps/web/src/lib/env.ts`                           | 직접 Render WSS와 Beta 공개 환경변수 검증                               |
| `apps/web/src/lib/http.test.ts`                     | 재시도/응답 형식/Timeout/인증 Cookie 회귀 검증                          |
| `apps/web/src/lib/http.ts`                          | 15초/90초 Timeout, HTML 오류, 안전한 작업만 재시도                      |
| `apps/web/src/lib/sync.ts`                          | 진행 중 들어온 요청을 후속 실행으로 처리해 초대 수락 후 Metadata 재조회 |
| `apps/web/src/lib/sync.test.ts`                     | 요청 병합, 실패 재시도, Offline, 유휴 조회 방지 회귀 검증               |
| `apps/web/src/lib/ui-store.ts`                      | 기록 Panel과 연결 준비/용량 경고 상태                                   |
| `apps/web/src/lib/workspace.ts`                     | 새 Workspace/Import의 Beta 자격 확인                                    |
| `apps/web/vercel.json`                              | Web 전용 Monorepo Build와 Git 자동 배포 비활성화                        |
| `compose.yaml`                                      | 기존 로컬 Compose와 Production 환경 검증 분리                           |
| `docs/api.md`                                       | Beta/기록/용량 API 계약과 오류 정의                                     |
| `docs/beta-launch.md`                               | 서비스 생성/환경 설정/배포/백업/공개 순서                               |
| `docs/beta-performance.json`                        | 1,000 Pages/Rows, 500 Blocks의 Beta 원시 측정                           |
| `docs/beta-validation.md`                           | Beta 검증 결과와 변경 파일 기록                                         |
| `docs/product/11-versioning-branching.md`           | 원본을 유지하는 새 Page 복구 정책 채택                                  |
| `docs/product/15-data-model.md`                     | Beta/Snapshot/Operation/Checkpoint 데이터 책임 추가                     |
| `docs/product/18-roadmap.md`                        | 무료 초대 Beta 구현 순서와 후속 기능 범위                               |
| `docs/product/19-decision-log.md`                   | Beta 확정 사항과 채택 기본안 기록                                       |
| `docs/validation.md`                                | Alpha 기록을 유지하고 최신 Beta 결과 연결                               |
| `package.json`                                      | 운영 코드 발급과 백업/복원 명령 제공                                    |
| `packages/shared/src/index.test.ts`                 | 새 Identity 복제, 빈 문서, 자기/외부 참조 보존 검증                     |
| `packages/shared/src/index.ts`                      | 공유 Beta/기록 계약과 새 Yjs 문서/링크/Task 복제                        |
| `render.yaml`                                       | Free 단일 인스턴스와 수동 배포 환경변수 정의                            |
| `scripts/backup.sh`                                 | pg_dump 17 + age 암호화, 저장소 밖 보관, 최근 4개 유지                  |
| `scripts/e2e-start.mjs`                             | Browser 서버에서 Beta 코드 요구 활성화                                  |
| `scripts/e2e.mjs`                                   | Browser Build에서 Beta 진입 필수 활성화                                 |
| `scripts/restore.sh`                                | 저장소 밖 Key로 빈 별도 DB에 Transaction 복원                           |
| `scripts/start.mjs`                                 | Web PORT와 Render Server PORT 분리                                      |
| `scripts/postgres-client.mjs`                       | 비밀번호 없는 접속 URL과 임시 0600 Password File로 운영 명령 실행       |
| `scripts/postgres-client.test.mjs`                  | TLS/IPv6/특수 문자와 잘못된 URL/Secret 옵션 검증                        |
| `vitest.config.ts`                                  | 운영용 PostgreSQL Client 회귀 테스트 포함                               |
| `tests/beta-helpers.ts`                             | Node로 운영 CLI를 직접 실행해 코드 발급/파일 정리                       |
| `tests/performance.spec.ts`                         | 실제 Beta 승인 후 기존 성능 목표 검증                                   |
| `tests/workspace.spec.ts`                           | 필수 코드와 Snapshot 미리보기/새 Page 복구 시나리오                     |
| `apps/web/src/lib/local-first.test.ts`              | 변경 없는 캐시 재저장 방지와 재시작 후 최신 변경 복구 검증              |

배포 검증 설정: `PLAYWRIGHT_BASE_URL=https://zeronote-kohl.vercel.app`을 사용하면 로컬 Server를 띄우지 않고 실제 서비스를 검사한다. HTTPS에서는 Session Cookie의 Domain·Secure·HttpOnly·SameSite를 추가 검증한다.

2026-10-07 최신 앱 소스 `86c9a01`의 CI 499 Tests/31 E2E/Docker/512MiB/20개 테이블 암호화 복원과 Render → Vercel 동일 소스 배포, 실제 HTTPS 9개 흐름 통과. Migration 10·Group Index 3개·Scope 오류/검색 Index 누락/검증용 Workspace 0건을 확인했다. [Member/Group 출시 기록](workspace-members-release.md).
