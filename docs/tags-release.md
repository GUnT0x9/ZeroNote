# Page Tags 구현·배포 기록

2026-10-06 전체 미완료 28번 Tag 시스템을 구현·검증하고 Beta에 배포했다. 전체 45/148 완료·103개 남음이며 전체 목표를 종료하지 않는다. 검색·Graph·추천의 나머지 8개는 계속 개발 대상이다.

Properties에서 문서와 Database의 Tag를 추가·이름 변경·제거한다. Page의 Yjs Map으로 저장하며 Unicode NFKC·공백·대소문자를 정리한 Key로 중복을 합치고 표시 이름은 보존한다. 한도는 30개·각 64자다. Owner/Editor가 수정하고 Viewer/Commenter와 Mobile에서는 읽는다. 저장 오류에서는 입력을 보존한다.

Tag는 두 기기에서 병합하고 Offline 저장·Reload·복제·Workspace Export/Import·Snapshot 미리보기/새 Page 복구에 포함한다. 기존 로컬 검색에도 Tag 이름을 포함한다. 동시에 추가해 30개를 초과하면 서버가 Commit을 거절하며 로컬 목록에서 Tag를 제거해 다시 저장할 수 있다. 잘못된 원격 Map과 Import를 거절한다.

Protocol 4와 Migration 008을 추가한다. 마지막 Tag를 제거한 뒤에도 호환성 표시를 유지한다. 이전 Web 버전은 Tag 문서를 읽거나 변경하지 못하며 기존 Block·Attachment·Database 문서는 각각 Protocol 1/2/3을 유지한다. DB를 자동으로 되감지 않는다.

다음 검색 단계에 사용할 source Index도 같은 Migration에 포함한다. Commit과 Snapshot 복구의 Checkpoint transaction에서 함께 저장한다. 기존 문서는 Ready 이전에 Page lock으로 Checkpoint+이후 Update에서 한 번 생성한다. Source Index에는 직접 저장한 값만 보관하고 Relation 이름과 Formula/Rollup 결과는 포함하지 않는다. 검색 API/UI와 Graph·추천은 아직 연결하지 않았으므로 해당 항목을 완료로 집계하지 않는다.

## 검증

- 로컬 전체 394 Tests와 lint·type-check 통과. Tag 정상/잘못된 값·중복·동시 변경·개수 초과·새 CRDT 복제, Source Index 계약/계산 모델/과거 삭제 내용 제외, Migration 8개와 Checkpoint atomicity, Import/복제/검색 회귀를 포함한다.
- 새 Playwright 시나리오는 두 기기 Tag 변경, Viewer 읽기 전용, Offline Reload/재접속, Snapshot 미리보기/복구와 복제를 검증한다. 로컬 새 시나리오 28.3초와 CI 전체 24 E2E(2.7분)가 통과했다. 1,000 Pages·1,000 Rows·500 Blocks의 캐시 문서 열기/검색 성능 기준도 CI에서 통과했다.
- CI에서 Server Docker/512MiB 시작, Migration 8개, 검색 Index를 포함한 16개 Table의 암호화 백업·별도 DB 복원 Fingerprint를 검증했고 통과했다.
- 실제 Android Chrome/iOS Safari 기기 확인은 이번 환경에서 실행할 수 없다. Chromium Mobile 회귀와 실제 기기 검증을 구분한다.

## 변경 파일과 이유

| 파일                                                                                               | 이유                                                                  |
| -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `packages/shared/src/page-tags.ts`, `page-tags.test.ts`                                            | Tag CRDT·이름/한도 검증·정상/경계/동시 변경 회귀                      |
| `packages/shared/src/knowledge-projection.ts`, `knowledge-projection.test.ts`                      | 현재 보이는 본문/Row/직접 속성/연결만 Index하고 요청별 계산 모델 복원 |
| `packages/shared/src/database-values.ts`, `search-normalize.ts`                                    | 공통 필터/값/정규화를 순환 import 없이 재사용                         |
| `packages/shared/src/database.ts`, `search-query.ts`, `index.ts`                                   | 필터 계약과 Projection/복제·공유 검색 요청 Schema 연결                |
| `packages/shared/src/editor-protocol.ts`, `editor-protocol.test.ts`                                | Tag 문서의 이전 Editor 접근 차단과 Protocol 유지 회귀                 |
| `apps/server/src/database/search-store.ts`, `document-store.ts`, `repository.ts`                   | Commit과 파생 Index의 transaction 및 기존 데이터 초기 생성            |
| `apps/server/src/database/migrations/008-knowledge-search.sql`, `migrations.ts`, `app.ts`          | Protocol Constraint/검색 Table과 Ready 이전 초기 생성                 |
| `apps/server/src/services.ts`, `integration.test.ts`, `migrations.test.ts`                         | 보이지 않는 부모의 Trash 상태와 저장 실패/복구/권한 회귀              |
| `apps/web/src/components/page-tags.tsx`, `context-panel.tsx`, `history-panel.tsx`                  | Properties 편집과 읽기 전용 Snapshot 미리보기                         |
| `apps/web/src/app/globals.css`                                                                     | 기존 중성색·폰트·간격을 사용한 Tag 목록/입력 UI                       |
| `apps/web/src/lib/database.ts`, `documents.ts`, `workspace.ts`, `search.ts`, `local-first.test.ts` | 로컬 Index·이전 Cache·Tag 검색과 복제/Import/저장 오류 보존           |
| `tests/workspace.spec.ts`, `.github/workflows/ci.yml`                                              | 사용자 흐름과 Migration/검색 Table 백업 복원 검증                     |
| `apps/web/public/sw.js`                                                                            | Protocol 4 Web의 Offline App Shell Cache를 v9로 갱신                  |
| `docs/api.md`, `docs/beta-launch.md`                                                               | 최신 Protocol 계약과 배포/운영 검증 결과                              |
| `docs/feature-checklist.md`, `docs/full-completion.md`                                             | Tag 28번 완료와 45/148·103개 남음 반영                                |
| `docs/knowledge-search-plan.md`, `docs/tags-release.md`                                            | 구현 범위·미완료 검색 기능과 검증 증거 기록                           |
| `docs/product/18-roadmap.md`, `docs/product/19-decision-log.md`                                    | 다음 검색·Knowledge 단계와 채택/검증 결정                             |

## Production 증거

- 앱 소스 `a09db74d91dd6a1d6fd5b868623ea805af315313`, [CI 37425661425](https://github.com/GUnT0x9/ZeroNote/actions/runs/37425661425) 성공. 로컬 lint·type-check·build와 전체 394 Tests가 통과했고 강화한 저장 rollback/기존 데이터 초기 생성 회귀 83개도 통과했다.
- Render `dep-db29m26i0phs73ds9ugg` Live → Vercel `dpl_3KJzvYVinwygVggB2cesAZkhAsMy` READY 순서로 배포했다. Production Alias/Project/`zeronoteCommit`/`githubCommitSha`가 같은 소스임을 Vercel API로 확인했다. Git Archive의 검증한 소스를 배포했다.
- 운영 DB Migration 8개, Checkpoint Protocol 1–4, Checkpoint의 source Index 누락 0건을 확인했다. 배포 전 암호화 백업 성공, 최근 4개 유지. Service Worker Cache를 v9로 갱신했다.
- [실제 Beta](https://zeronote-kohl.vercel.app) HTTPS 3개 흐름 통과(2.1분): Page 초대/Realtime/Comments/Viewer/Recovery 37.8초, Tag 변경/Offline Reload/재접속/Viewer/Snapshot/복제/검색 34.3초, File/Formula/Relation/Rollup/권한 철회/Offline/Snapshot 40.2초. Cookie REST와 직접 WSS 연결을 함께 확인했다.
- 검증 Workspace 잔여 0건을 DB에서 확인했다. 운영 앱의 기능 상태와 아직 연결되지 않은 검색 API/Graph/추천을 구분한다. 실제 Android/iOS 기기 검증과 Native 패키지는 계속 미완료다.
