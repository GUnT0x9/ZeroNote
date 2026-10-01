# ZeroNote 초대 Beta 검증

검증일: 2026-10-01. Beta 코드·저장 안정화·Snapshot·배포 구성을 구현했다. 실제 Vercel/Render/Neon 서비스는 아직 생성하지 않았다. 서비스 설정과 공개 전 확인은 [운영 문서](beta-launch.md)에 정리했다.

## 실행 결과

| 검증                                                       | 결과                                                                  |
| ---------------------------------------------------------- | --------------------------------------------------------------------- |
| `pnpm lint`                                                | 통과                                                                  |
| `pnpm type-check`                                          | Web/Server/Shared/Browser 테스트 통과                                 |
| `pnpm test`                                                | 9개 파일, 77개 테스트 통과                                            |
| `pnpm test:e2e`                                            | Production Build와 필수 Beta 코드 환경에서 Chromium 8개 시나리오 통과 |
| `pnpm build`                                               | Web Production Build와 Server TypeScript 통과                         |
| PostgreSQL 17, 서버 Docker Build, 암호화 백업/별도 DB 복원 | GitHub CI 실행 후 기록                                                |

로컬 환경은 Node.js 24.14.1, pnpm 11.9.0, PostgreSQL 14.24다. 로컬 Docker 실행 경로가 끊겨 있어 PostgreSQL 17/Docker/age 백업 검증을 CI로 수행한다. Browser 테스트는 실제 운영 CLI로 발급한 코드를 사용한다. 코드가 없는 Page 초대와 새 기기 Recovery도 함께 검증했다.

## 회귀 방지 근거

- Beta: 동시 일회성 코드 수락, 같은 기기의 재시도, 만료/재사용 거절, Workspace 3개 제한, 같은 Workspace 동시 생성, Recovery 자격 상속, 코드 없는 Page 초대.
- 저장: 기존 Alpha 데이터의 Migration, 반복 Migration, 더러운 옛 Checkpoint 제외, Commit/Checkpoint 실패 시 Rollback, 로그 정리 후 재시작, 정리된 Operation 재전송과 Payload 충돌, 누적 5MiB 제한, 용량 초과 시 기존 데이터 보존.
- 협업: 실제 WebSocket 5명 동시 편집, Offline 병합, 원격 변경을 유지하는 Undo, Viewer/Commenter 쓰기 차단, 검증된 Presence Identity, Presence Heartbeat의 DB 권한 조회 제거.
- 기록: 불변 Snapshot, 하루 첫 Commit의 자동 기록, 자동 만료/삭제, 수동 3개 제한, Owner 외 거절, 읽기 전용 미리보기, Task Row/본문 복구, 자기 참조 재매핑, Trash 복구, 비공유 Root Page 생성, 복구 Operation 재시도.
- 연결/Local: HTML 오류 응답, 일반/Cold Start Timeout, 안전한 작업만 재시도, Offline 승인 Cache, 저장 공간 부족과 접근 철회 후 로컬 보존, Offline 새로고침/재접속.
- Mobile/이전: Chromium Touch Viewport의 읽기·Capture·Comments·Focus, Export/Import 문서·Task·링크 보존 및 Secret 제외.

## 성능

동일한 캐시 데이터인 1,000 Pages, 500 Blocks 문서, 1,000 Task Rows로 측정했다. 성능 Threshold는 완화하지 않았다.

| 지표           | 로컬 Beta 측정 | 목표         |
| -------------- | -------------- | ------------ |
| 캐시 문서 열기 | 819.2ms        | 1,000ms 미만 |
| Local Search   | 43ms           | 200ms 미만   |

측정은 Browser 안의 입력부터 렌더 완료 후 두 번째 Animation Frame까지다. 원시 수치는 [beta-performance.json](beta-performance.json)에 있다. 단일 Headless 실행 수치이며 운영 기기/실제 Cold Start 성능을 보장하는 값은 아니다.

## 공개 전 남은 검증

- 실제 HTTPS의 Cookie·REST Rewrite·Render WSS·Origin 거절·서버 재시작 후 복원.
- Render Sleep 이후 실제 Cold Start 대기 시간과 동기화 상태.
- 실제 Android Chrome/iOS Safari의 읽기·Capture·Comments·Keyboard Focus.
- Production 암호화 백업을 별도 DB에 복원한 뒤 문서·Task·권한 확인.
- 운영자 2명 사용 후 5–10명으로 확대.

## 변경 파일과 이유

아래 목록은 Beta 변경 파일이다. Alpha 구현 기록은 [validation.md](validation.md)에 보존했다.

| 파일                                                | 변경 이유                                               |
| --------------------------------------------------- | ------------------------------------------------------- |
| `.dockerignore`                                     | Docker Context에서 Secret과 백업 제외                   |
| `.env.example`                                      | Vercel/Render/Beta 환경변수 설정 예시                   |
| `.github/workflows/ci.yml`                          | PostgreSQL 17, 서버 Docker, 암호화 백업/복원 검증       |
| `.gitignore`                                        | 배포 연결 파일과 코드/백업/복호화 Key 제외              |
| `Dockerfile.server`                                 | Render에서 서버만 실행하는 Node 24 이미지               |
| `README.md`                                         | Beta 실행 범위와 운영/검증 안내                         |
| `apps/server/package.json`                          | 운영자 전용 Beta 코드 발급 명령                         |
| `apps/server/src/app.ts`                            | 공유 문서 Service, 인증 API no-store, 전송 Frame 한도   |
| `apps/server/src/beta-cli.ts`                       | Hash만 저장하는 일회성 코드 10개를 저장소 밖에 발급     |
| `apps/server/src/beta.test.ts`                      | 초대코드/자격/기록/로그 정리/용량의 정상과 실패 검증    |
| `apps/server/src/database/beta-store.ts`            | 동시 코드 수락과 자격당 Workspace 제한                  |
| `apps/server/src/database/document-store.ts`        | Commit/Checkpoint/로그 정리/Operation Hash/용량 처리    |
| `apps/server/src/database/migrations.ts`            | 버전별 Migration과 중복 실행 Lock                       |
| `apps/server/src/database/migrations/001-alpha.sql` | 기존 Alpha Schema를 첫 Migration으로 보존               |
| `apps/server/src/database/migrations/002-beta.sql`  | Beta 자격/Checkpoint 위치/Operation/Snapshot Schema     |
| `apps/server/src/database/repository.ts`            | Migration/새 Store 연결과 생성 제한/Recovery 자격 상속  |
| `apps/server/src/database/snapshot-store.ts`        | 기록 보관/중복 처리/새 비공유 Page 복제                 |
| `apps/server/src/env.ts`                            | Render PORT, Production 필수 Secret/HTTPS/TLS 검증      |
| `apps/server/src/errors.ts`                         | Repository와 Service의 공통 DomainError                 |
| `apps/server/src/migrations.test.ts`                | 기존 Alpha 데이터 보존과 Migration 중복 실행 검증       |
| `apps/server/src/realtime.test.ts`                  | Presence의 메모리 처리와 문서 권한 재검사 검증          |
| `apps/server/src/realtime.ts`                       | WS 적용 전에 Commit/한도 검사, Presence DB Polling 제거 |
| `apps/server/src/routes.ts`                         | Beta/기록/용량 API와 Comment 변경 이벤트                |
| `apps/server/src/services.ts`                       | 문서 Commit을 원자적인 Repository 저장으로 통합         |
| `apps/server/src/snapshot-service.ts`               | Owner 전용 기록과 Trash 복구 권한/Version 검사          |
| `apps/web/env.config.ts`                            | Web Build의 API/Collaboration 공개 설정 검증            |
| `apps/web/next.config.ts`                           | 검증된 Render Origin으로 기존 REST Rewrite 연결         |
| `apps/web/src/app/globals.css`                      | 기록 목록/미리보기 UI 스타일                            |
| `apps/web/src/components/block-editor.tsx`          | 로컬 저장 Provider 없이 읽기 전용 기록 렌더             |
| `apps/web/src/components/context-panel.tsx`         | 기록 탭과 이벤트 기반 Comment 갱신                      |
| `apps/web/src/components/dialogs.tsx`               | Beta 코드 수락과 Recovery 자격 Cache                    |
| `apps/web/src/components/document-view.tsx`         | Owner 기록 버튼과 Visible 재접속                        |
| `apps/web/src/components/history-panel.tsx`         | 기록 생성/조회/삭제/미리보기/새 Page 복구               |
| `apps/web/src/components/sidebar.tsx`               | Beta 환경의 제품 표시                                   |
| `apps/web/src/components/workspace-app.tsx`         | 연결 준비/서버 용량/생성 거절 상태와 Trash 기록         |
| `apps/web/src/lib/api.ts`                           | Cold Start 준비 후 Device Challenge와 요청 처리 통합    |
| `apps/web/src/lib/beta.test.ts`                     | 승인 Cache/미승인/개수 제한/수락 응답 검증              |
| `apps/web/src/lib/beta.ts`                          | 승인 Status Cache와 Offline Workspace 제한              |
| `apps/web/src/lib/database.ts`                      | 거절된 로컬 Workspace의 오류 보존                       |
| `apps/web/src/lib/documents.ts`                     | 직접 WSS, Comment 이벤트, Background 연결 해제          |
| `apps/web/src/lib/env.test.ts`                      | 기본/외부 WSS URL 생성과 잘못된 설정 검증               |
| `apps/web/src/lib/env.ts`                           | 직접 Render WSS와 Beta 공개 환경변수 검증               |
| `apps/web/src/lib/http.test.ts`                     | 재시도/응답 형식/Timeout/인증 Cookie 회귀 검증          |
| `apps/web/src/lib/http.ts`                          | 15초/90초 Timeout, HTML 오류, 안전한 작업만 재시도      |
| `apps/web/src/lib/sync.ts`                          | 유휴 Polling 제거와 생성 거절/저장 한도 시 Queue 보존   |
| `apps/web/src/lib/ui-store.ts`                      | 기록 Panel과 연결 준비/용량 경고 상태                   |
| `apps/web/src/lib/workspace.ts`                     | 새 Workspace/Import의 Beta 자격 확인                    |
| `apps/web/vercel.json`                              | Web 전용 Monorepo Build와 Git 자동 배포 비활성화        |
| `compose.yaml`                                      | 기존 로컬 Compose와 Production 환경 검증 분리           |
| `docs/api.md`                                       | Beta/기록/용량 API 계약과 오류 정의                     |
| `docs/beta-launch.md`                               | 서비스 생성/환경 설정/배포/백업/공개 순서               |
| `docs/beta-performance.json`                        | 1,000 Pages/Rows, 500 Blocks의 Beta 원시 측정           |
| `docs/beta-validation.md`                           | Beta 검증 결과와 변경 파일 기록                         |
| `docs/product/11-versioning-branching.md`           | 원본을 유지하는 새 Page 복구 정책 채택                  |
| `docs/product/15-data-model.md`                     | Beta/Snapshot/Operation/Checkpoint 데이터 책임 추가     |
| `docs/product/18-roadmap.md`                        | 무료 초대 Beta 구현 순서와 후속 기능 범위               |
| `docs/product/19-decision-log.md`                   | Beta 확정 사항과 채택 기본안 기록                       |
| `docs/validation.md`                                | Alpha 기록을 유지하고 최신 Beta 결과 연결               |
| `package.json`                                      | 운영 코드 발급과 백업/복원 명령 제공                    |
| `packages/shared/src/index.test.ts`                 | 새 Identity 복제, 빈 문서, 자기/외부 참조 보존 검증     |
| `packages/shared/src/index.ts`                      | 공유 Beta/기록 계약과 새 Yjs 문서/링크/Task 복제        |
| `render.yaml`                                       | Free 단일 인스턴스와 수동 배포 환경변수 정의            |
| `scripts/backup.sh`                                 | pg_dump 17 + age 암호화, 저장소 밖 보관, 최근 4개 유지  |
| `scripts/e2e-start.mjs`                             | Browser 서버에서 Beta 코드 요구 활성화                  |
| `scripts/e2e.mjs`                                   | Browser Build에서 Beta 진입 필수 활성화                 |
| `scripts/restore.sh`                                | 저장소 밖 Key로 빈 별도 DB에 Transaction 복원           |
| `scripts/start.mjs`                                 | Web PORT와 Render Server PORT 분리                      |
| `tests/beta-helpers.ts`                             | 실제 운영 CLI로 테스트 코드 발급 후 파일 정리           |
| `tests/performance.spec.ts`                         | 실제 Beta 승인 후 기존 성능 목표 검증                   |
| `tests/workspace.spec.ts`                           | 필수 코드와 Snapshot 미리보기/새 Page 복구 시나리오     |
