# Database 속성 확장 구현·배포 기록

2026-10-06 전체 미완료 38–41번 File Property/Formula/Relation/Rollup을 구현·검증하고 Beta에 배포했다. 전체 148개 중 44개 완료·104개 남음이며 전체 목표를 종료하지 않는다.

File은 기존 로컬 bytes/업로드 Queue/권한/용량/Preview/다운로드/Snapshot을 재사용한다. Relation은 같은 Workspace의 허용된 Database/활성 Row ID를 연결하며 권한을 전파하지 않는다. Formula는 이름을 안정적인 ID AST로 변환하고 제한된 문법·함수·형/순환/계산량 검사를 적용한다. Rollup은 허용된 대상의 집계를 읽기 전용으로 계산한다. Table/Board/상세/검색 조건/Export는 같은 Reader를 사용한다.

Public은 게시 범위 밖 대상과 Person/비공개 파생 값·ID/이름을 제외한다. Snapshot은 정의/값/Row 본문/파일을 복원하고 자기 Database ID와 파일 ID를 새 문서에 맞게 재매핑한다. 외부 Database의 과거 상태는 복사하지 않으며 현재 허용된 대상 값을 계산한다. Workspace Import는 포함된 Database ID를 재매핑한다.

## 검증

- lint·type-check·Web/Server build 및 전체 343 Unit/Server Tests 통과. AST/집계·형·순환·계산량, 파일 참조 보호·Public Scope·Protocol, 저장 실패·동시 필드 변경·Snapshot·Migration/기존 데이터 회귀를 포함한다.
- CI 전체 23 E2E 통과(2.5분), 로컬 전체 23 E2E 통과(8.0분). 새 시나리오는 File 업로드/Preview/다운로드·속성/Row 이름 변경·계산 변경·Offline Reload·Viewer 쓰기 거절·추가 초대 수락·철회 후 관계 이름/계산 제외·Snapshot 새 Page 복구를 확인했다.
- 권한 철회의 Hocuspocus 문서 Close에서 REST가 확인한 403/410만 접근에서 제외한다. 정상/503/Offline 종료에서 데이터와 접근을 유지하고 미전송 수정은 보존한다. 시나리오별 Forwarded 헤더는 효과가 없어 제거했고 테스트 발급 예산을 조절했다. 서버의 Beta 15회/IP/분 제한과 16회째 429 회귀를 유지했다.
- 1,000 Pages/1,000 Task Rows/500 Blocks: 캐시 문서 열기 378.7ms, Local Search 31.0ms. 로컬 Chromium 1440×960의 브라우저 측정이며 자동화 호출 비용과 Cold Start는 별도다.
- CI Server Docker Build, 512MiB에서 시작/Health, Migration 7개, 암호화 백업·별도 DB 복원과 15개 Table Fingerprint 일치를 확인했다. 배포 전 Production 암호화 백업을 실행했고 최근 4개를 보관했다.

## Production 증거

- 앱 소스 `f7b4c00931c19e172af335567c3131c72ef935f4`. [CI 37419348014](https://github.com/GUnT0x9/ZeroNote/actions/runs/37419348014) 성공.
- Render `dep-db28kn7lot8c73e9dgm0` Live → Vercel `dpl_GsQkUKKPd3RYvZjDKs1wXL5SVpwA` READY 순서로 배포했다. Production Alias와 Project ID, `zeronoteCommit`/`githubCommitSha`가 동일 소스임을 Vercel API로 확인했다. 작업 중인 다음 기능을 포함하지 않은 Git Archive를 업로드했다.
- Production DB Migration 7개와 Checkpoint Protocol 1–3 Constraint를 직접 확인했다. 앱 버전만 되돌릴 수 있으며 DB를 자동으로 되감지 않는다. 새 Property 문서는 Protocol 3을 이해하는 Editor가 필요하다.
- [실제 Beta](https://zeronote-kohl.vercel.app) HTTPS 브라우저 2개 흐름 통과(1.4분): Page 초대·두 기기 Realtime·Comments·Viewer 차단·새 기기 Recovery(32.5초), 새 Property·이름 변경·Offline Reload·공유 수락/철회·Snapshot 새 Page 복구(39.9초). Cookie REST 전달과 직접 WSS 연결을 이 흐름에서 확인했다.
- 검증용 Workspace의 최근 잔여 수가 0임을 DB에서 확인했다. 실제 Android Chrome/iOS Safari 기기는 이번 실행 환경에서 검사하지 못했다. Mobile은 Chromium Touch/Viewport 회귀이며 실제 기기 확인과 Native 패키지는 별도 미완료 범위다.

## 변경 파일과 이유

출시 소스와 직전 Production `0b25956`의 차이 기준이다.

| 파일                                                              | 이유                                                  |
| ----------------------------------------------------------------- | ----------------------------------------------------- |
| `.github/workflows/ci.yml`                                        | Migration 7개와 신규 Protocol의 백업 복원 확인        |
| `apps/server/src/attachment-routes.ts`                            | Owner의 Snapshot 보존 파일 Metadata 조회              |
| `apps/server/src/attachment-service.ts`                           | 역할·Trash·보존 파일 조회 범위 확인                   |
| `apps/server/src/database/attachment-store.ts`                    | Row 파일 참조와 Snapshot/영구 정리 보호               |
| `apps/server/src/database/document-store.ts`                      | 새 Property/AST/값 검증 후 Commit                     |
| `apps/server/src/database/migrations.ts`                          | Migration 007 등록과 기존 데이터 유지                 |
| `apps/server/src/database/migrations/007-database-properties.sql` | Checkpoint Protocol 1–3 허용                          |
| `apps/server/src/database/public-share-store.ts`                  | Public 파일과 게시 의존 범위 적용                     |
| `apps/server/src/integration.test.ts`                             | 관련 정상·경계·권한/실패 회귀 검증                    |
| `apps/server/src/migrations.test.ts`                              | 관련 정상·경계·권한/실패 회귀 검증                    |
| `apps/server/src/public-projection.test.ts`                       | 관련 정상·경계·권한/실패 회귀 검증                    |
| `apps/server/src/public-projection.ts`                            | 게시 범위의 Relation/계산 값과 파일만 Projection      |
| `apps/server/src/public-sharing.test.ts`                          | 관련 정상·경계·권한/실패 회귀 검증                    |
| `apps/server/src/realtime.test.ts`                                | 관련 정상·경계·권한/실패 회귀 검증                    |
| `apps/web/public/sw.js`                                           | 새 App Shell Asset 버전 반영                          |
| `apps/web/src/app/globals.css`                                    | 중성색 Property/Cell/Preview UI 간격과 상태           |
| `apps/web/src/components/context-panel.tsx`                       | 속성/기록의 접근 가능한 데이터 전달                   |
| `apps/web/src/components/database-advanced-cell.tsx`              | File·Relation·Formula·Rollup Cell과 Preview/선택 UI   |
| `apps/web/src/components/database-date-views.tsx`                 | 다른 View와 같은 속성 계산 값 사용                    |
| `apps/web/src/components/database-property-definition.tsx`        | 4개 속성 설정과 Formula 미리보기                      |
| `apps/web/src/components/database-property.tsx`                   | Row 상세의 읽기 전용 계산/파일/관계 편집              |
| `apps/web/src/components/database-settings.tsx`                   | Relation 대상 변경 확인과 속성 설정 통합              |
| `apps/web/src/components/document-view.tsx`                       | 문서 범위와 Database 의존 값 전달                     |
| `apps/web/src/components/history-panel.tsx`                       | Snapshot Row 값과 보존 파일명 미리보기                |
| `apps/web/src/components/task-database.tsx`                       | Table/Board/상세/조건의 동일 Reader 연결              |
| `apps/web/src/lib/attachment-metadata.test.ts`                    | 관련 정상·경계·권한/실패 회귀 검증                    |
| `apps/web/src/lib/attachment-metadata.ts`                         | bytes 없는 파일명 Cache와 Owner 기록 병합             |
| `apps/web/src/lib/attachments.test.ts`                            | 관련 정상·경계·권한/실패 회귀 검증                    |
| `apps/web/src/lib/attachments.ts`                                 | 동기화된 revision 0 Page와 업로드 상태 처리           |
| `apps/web/src/lib/database-context.test.ts`                       | 관련 정상·경계·권한/실패 회귀 검증                    |
| `apps/web/src/lib/database-context.ts`                            | 허용된 의존 문서 구독과 접근 철회 갱신                |
| `apps/web/src/lib/database-definitions.test.ts`                   | 관련 정상·경계·권한/실패 회귀 검증                    |
| `apps/web/src/lib/database-definitions.ts`                        | 속성 설정 변환과 기존 Relation 값 해제                |
| `apps/web/src/lib/database-export.test.ts`                        | 관련 정상·경계·권한/실패 회귀 검증                    |
| `apps/web/src/lib/database-export.ts`                             | 접근 범위의 Markdown/HTML/CSV 계산 값                 |
| `apps/web/src/lib/document-files.test.ts`                         | 관련 정상·경계·권한/실패 회귀 검증                    |
| `apps/web/src/lib/documents.ts`                                   | Token/인증/문서 Close의 접근 확인과 미전송 보존       |
| `apps/web/src/lib/http.test.ts`                                   | 관련 정상·경계·권한/실패 회귀 검증                    |
| `apps/web/src/lib/pdf-export.ts`                                  | PDF 표의 동일 계산 결과 출력                          |
| `apps/web/src/lib/portable-archive.ts`                            | 이전 파일 형식에서 속성 값/파일 유지                  |
| `apps/web/src/lib/workspace.ts`                                   | 복제/Import의 Database·파일 ID 재매핑                 |
| `docs/api.md`                                                     | API·제품 계약·완료 상태와 배포 증거 기록              |
| `docs/beta-launch.md`                                             | API·제품 계약·완료 상태와 배포 증거 기록              |
| `docs/database-advanced-plan.md`                                  | API·제품 계약·완료 상태와 배포 증거 기록              |
| `docs/feature-checklist.md`                                       | API·제품 계약·완료 상태와 배포 증거 기록              |
| `docs/full-completion.md`                                         | API·제품 계약·완료 상태와 배포 증거 기록              |
| `docs/product/06-database-spec.md`                                | API·제품 계약·완료 상태와 배포 증거 기록              |
| `docs/product/18-roadmap.md`                                      | API·제품 계약·완료 상태와 배포 증거 기록              |
| `docs/product/19-decision-log.md`                                 | API·제품 계약·완료 상태와 배포 증거 기록              |
| `docs/public-sharing-release.md`                                  | API·제품 계약·완료 상태와 배포 증거 기록              |
| `packages/shared/src/attachments.test.ts`                         | 관련 정상·경계·권한/실패 회귀 검증                    |
| `packages/shared/src/attachments.ts`                              | 활성 File Property 참조와 파일 ID 재매핑              |
| `packages/shared/src/database-computation.test.ts`                | 관련 정상·경계·권한/실패 회귀 검증                    |
| `packages/shared/src/database-computation.ts`                     | 제한된 의존 계산·집계·Public 파생 값 보호             |
| `packages/shared/src/database.ts`                                 | 4개 속성 Schema와 읽기 전용 값/조건                   |
| `packages/shared/src/editor-protocol.test.ts`                     | 관련 정상·경계·권한/실패 회귀 검증                    |
| `packages/shared/src/editor-protocol.ts`                          | 새 Property의 최소 Protocol 3 판정                    |
| `packages/shared/src/formula.test.ts`                             | 관련 정상·경계·권한/실패 회귀 검증                    |
| `packages/shared/src/formula.ts`                                  | 제한된 AST 파서/계산/이름 변경 Formatter              |
| `packages/shared/src/index.ts`                                    | 공유 인터페이스와 복원 데이터 연결                    |
| `playwright.config.ts`                                            | 브라우저 *.spec.ts 수집 범위 명시                     |
| `tests/beta-helpers.ts`                                           | 운영자 코드 발급의 실제 요청 예산 적용                |
| `tests/helpers/beta-request-budget.test.ts`                       | 관련 정상·경계·권한/실패 회귀 검증                    |
| `tests/helpers/beta-request-budget.ts`                            | 실제 Beta 제한 안에서 테스트 요청 직렬 예약           |
| `tests/workspace.spec.ts`                                         | 실제 UI·Offline·공유/철회·Snapshot/Recovery 흐름 검증 |
| `vitest.config.ts`                                                | Helper Unit 테스트를 별도 검증에 포함                 |
