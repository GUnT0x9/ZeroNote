# 전체 문서·속성 검색 출시 기록

2026-10-06 구현·배포, 2026-10-07 실제 HTTPS 검증. 대상: Global Full-text Search, Search Filter, Search by Property, Fuzzy Search, Search Operators의 5개 기능. CI와 Production 검증을 마쳤으며 50/148 완료·98개 계속 구현이다. Graph·Related Pages·Broken Link와 다른 미완료 요구는 계속 구현 대상이다.

## 동작

- Search는 현재 Workspace에서 시작하며 전체 Workspace를 선택할 수 있다. 접근 가능한 Page 제목·본문·Tag, Database Row 제목·본문·속성 값과 계산 결과를 검색한다. Row를 선택하면 상세 화면으로 이동한다.
- 같은 공유 엔진을 Offline 로컬 source와 서버의 Commit된 source Index에 적용한다. 미열람 문서의 본문 전체를 내려받지 않고 서버 검색 결과를 받는다. 문서를 열 때 본문을 저장하며, Offline에서는 이미 저장된 본문과 Metadata 제목을 검색한다.
- 기존 Backlinks도 저장된 문서 기준임을 표시하고 상위 Trash/철회된 source를 제외한다. 전체 연결 조회는 다음 Knowledge/Graph 묶음에서 source Index와 연결한다.
- 따옴표 구문·제외어·type/tag/workspace/database/after/before와 typed prop 조건을 공유 AST로 검증한다. 알 수 없는 연산자, 실제 날짜가 아닌 값, 미닫힌 따옴표는 요청 전에 표시한다. 모든 조건은 AND다. before는 UTC 수정일 미만, after는 UTC 수정일 이상이다.
- 정확/접두/부분 일치를 우선한다. 3–64자 문자 단어에서 한 번의 삽입·삭제·치환·인접 교환을 허용하고 오타 후보로 표시한다. 숫자·따옴표 구문·제외어는 오타를 확장하지 않는다. 오타 비교는 각 결과의 앞 32KiB·최대 2,048단어에 한정하고 정확한 본문 검색은 이 제한을 사용하지 않는다.
- 속성은 Database/Property ID로 선택한다. 연산자 입력의 동일 이름 속성이 여러 개면 매칭하지 않는다. Table의 typed 비교 함수를 재사용하며, Formula/Rollup·Relation·File 이름을 요청자 범위에서 계산한다. 삭제·철회·상위 Trash·다른 Workspace의 의존성을 제외하고 알 수 없는 값을 0/빈 값/부정 조건의 참으로 취급하지 않는다.
- 미전송 수정은 최대 32개 source overlay로 검색 요청에만 적용한다. 접근 가능하고 편집 권한이 있는 Page만 사용하며 Index나 원본에 저장하지 않는다. 서버에서 최신 결과가 오면 오래된 clean 로컬 결과를 다시 합치지 않는다. 아직 등록 대기 중인 새 Page만 로컬 결과를 추가한다.
- 범위/검색어/수정 세대가 바뀌면 이전 응답을 버리고 요청을 취소한다. 실패하면 로컬 결과와 범위를 표시한다. GET, Operation ID 작업과 명시적인 읽기 전용 Search POST만 재시도한다.
- 서버는 8 Page씩 검색하고 필요한 접근 가능 Database 의존성을 요청 안에서만 읽는다. batch source 16MiB와 동시 2개 요청으로 Render Free의 메모리를 제한하며, 범위가 너무 크면 축소 요청 오류를 반환한다. 권한·API 결과를 Service Worker나 영속 검색 Cache에 저장하지 않는다.

## 검증

- 로컬 전체 420 Tests 통과(78.35초): parser/matcher·Unicode·긴 본문·typed 값·Formula/Rollup·파일 이름·ACL·Trash·임시 변경·Abort/재시도·on-demand 동기화.
- actual matcher의 1,000 Pages·1,000 Rows·500 Blocks 조건에서 준비된 Index의 검색 200ms 기준을 검증한다.
- Browser 회귀: 새 브라우저 Recovery 이후 미열람 Page 검색, Tag·Property UI, Row 열기, 오타 후보, 문법 오류, Offline 수정과 서버 전송 실패 중의 검색. 로컬 Search E2E 18.1초·성능 E2E 15.8초 통과.
- Source `15f2036e96bc463e2499f730e4e6ccb0f954a9ef`의 [CI 37431481786](https://github.com/GUnT0x9/ZeroNote/actions/runs/37431481786) 통과: lint/type-check/420 Tests/25 E2E(2.9분)/build/서버 Docker/512MiB 기동/8 Migrations/16개 Table 암호화 백업 복원. 실제 Android Chrome/iOS Safari 검증은 아직 미실시다.

## Production 증거

- Render `dep-db2ai7rtqb8s73cn5md0` Live와 Vercel `dpl_GVgHZwPr813Qyu4YBh2HuujwAnUX` READY가 같은 `15f2036` 소스다. Production Alias/Project ID와 `zeronoteCommit`/`githubCommitSha`를 Vercel API에서 확인했다.
- 배포 전에 PostgreSQL 17의 암호화 백업을 생성했고 최근 4개 보관을 확인했다. HTTPS 확인 후 Migration 8개, Protocol 1–4, Checkpoint에 대응하는 source Index 누락 0건, DB 11,124,736 bytes, QA Workspace 0개다.
- [Beta](https://zeronote-kohl.vercel.app)에서 3개 Browser 흐름 통과(3.8분): 새 기기 미열람 검색·Tag/Property 조건·Row 상세·오타·문법 오류·Offline/전송 실패 중 로컬 수정 반영(1.3분), 두 기기 Realtime·Comments·Viewer·Recovery(1.2분), File/Formula/Relation/Rollup·Rename·권한 철회·Offline Reload·Snapshot(53.8초).
- 첫 CI에서 제목 표시 직후 본문 저장을 확인하는 테스트가 실패했다. 실제 IndexedDB 저장 완료를 기다린 후 Offline으로 전환하도록 수정한 최종 소스의 전체 CI와 HTTPS 재검증이 통과했다. 판정은 최종 검증을 기준으로 한다.

## 변경 파일과 이유

| 파일                                                                                                                                                                                                                | 변경 이유                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `packages/shared/src/search-query.ts`                                                                                                                                                                               | database 연산자와 일시적인 로컬 source overlay 요청 검증                 |
| `packages/shared/src/search-results.ts`, `search-engine.ts`, `index.ts`                                                                                                                                             | 공유 결과 Schema·정렬·본문/Row/typed Property/오타 매칭과 요청 범위 계산 |
| `apps/server/src/search-service.ts`, `search-routes.ts`, `routes.ts`                                                                                                                                                | 인증된 검색/속성 API와 메모리 제한·ACL 검사                              |
| `apps/server/src/database/attachment-store.ts`                                                                                                                                                                      | 파일 bytes를 읽지 않는 scoped 이름 조회                                  |
| `apps/web/src/lib/advanced-search.ts`, `use-search.ts`                                                                                                                                                              | Offline source·필터 AST·원격 검색·미전송 수정 병합·오래된 응답 차단      |
| `apps/web/src/components/search-filters.tsx`, `dialogs.tsx`, `app/globals.css`                                                                                                                                      | 기존 Search/Command UI에 필터·속성 조건·범위/오타/오류와 Row 이동 추가   |
| `apps/web/src/lib/api.ts`, `http.ts`, `sync.ts`                                                                                                                                                                     | 검색 취소/안전한 재시도와 문서 본문 on-demand 저장                       |
| `packages/shared/src/search-engine.test.ts`, `apps/web/src/lib/advanced-search.test.ts`, `http.test.ts`, `sync.test.ts`, `apps/server/src/integration.test.ts`, `search-service.test.ts`, `tests/workspace.spec.ts` | 검색·범위·값 계산·실패·성능과 실제 브라우저 회귀                         |
| `apps/web/src/components/context-panel.tsx`                                                                                                                                                                         | Backlinks의 로컬 조회 범위와 상위 Trash/철회 제외                        |
| `docs/api.md`, `knowledge-search-plan.md`, `product/19-decision-log.md`, `search-release.md`                                                                                                                        | 검색 API·동작 기본안·검증 및 배포 증거                                   |
