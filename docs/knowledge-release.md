# Graph·관련 문서·링크 상태 구현 기록

2026-10-07 구현·배포·실제 HTTPS 검증 완료. 기존 미구현 25–27번: Knowledge Graph, Related Pages, Broken Link 탐지. 현재 검증된 완료는 53/148이며 나머지 95개는 계속 구현 대상이다.

## 동작

- 기존 Backlinks Context Panel에 Backlinks·관련 문서·링크 상태 탭과 Graph 진입을 제공한다. 새 기기에서도 열지 않은 접근 가능한 문서/Row의 연결을 서버 source Index로 조회한다. 기존 캐시된 본문 조회는 Offline 범위로 유지한다.
- Graph는 선택한 Page와 직접 연결한 Page/Database를 최대 200개씩 보여준다. Row 연결은 Database Node로 묶으며 연결 종류를 표시한다. 방향성 연결, 확대/축소·Pan·전체 맞추기·이전/다음 문서·목록 대체·키보드 선택/Enter·문서 열기를 제공한다. 최대 연결선 800개, 목록 200개 제한과 전체 개수를 표시한다.
- 관련 문서는 같은 Workspace의 직접 연결·공통 Tag·제한된 본문 단어를 근거로 결정적으로 정렬한다. 근거를 표시하고 자기 자신·Trash·권한 밖을 제외한다. 언어 모델이나 사용자의 사적 계산 값을 Index에 보관하지 않는다.
- 링크 상태는 알려진 Trash·삭제/누락 Row·접근 확인 불가를 구분한다. 범위 밖 대상의 존재/삭제를 추측하거나 비공개 이름을 조회하지 않는다. 원문 링크는 유지하며 원래 본문/Row로 열거나 명시적으로 교체한다.
- Mention/Task Link는 선택한 본문의 같은 대상 링크를 함께 교체한다. Relation은 사용자가 고른 한 Property의 한 Row 참조를 교체하며 다른 속성/연결을 유지한다. Relation 대상 Database를 바꾸는 일괄 변경은 Properties에서 관리한다. 동시에 변경/삭제된 원래 링크와 대상 Row, 철회된 편집 권한을 다시 검사하고 로컬 저장 오류에서는 성공으로 닫지 않는다.
- 서버/로컬에서 같은 연결 계산을 사용한다. Dirty source는 편집 권한을 확인한 요청 전용 Overlay로 적용한다. 새 Page 등록 대기는 로컬 범위를 표시하며 등록 후 서버 조회를 시작한다. 오래된 응답을 취소하고 권한·Metadata·문서 세대 변화에서 다시 계산한다. 인증 응답을 영속 Cache하지 않으며 유휴 Polling을 추가하지 않는다.
- 상위 Page가 공유되지 않거나 접근이 철회돼도 독립된 하위 Page Grant는 유지한다. Trash는 하위 Page까지 적용한다. Mention/Task Link UI도 접근/삭제/Row 상태를 확인하고 철회된 대상의 캐시된 이름을 표시하지 않는다.

## 검증

로컬 전체 440 Tests/53 files 통과(80.42초), lint/type-check 통과. 새 기기 미열람 Graph/Backlinks·관련 Tag 근거·키보드/목록/확대/Pan·Trash 상태·Offline 링크 교체와 새로고침/두 기기 재접속(27.4초), Mobile Touch 읽기/작성/Capture/Comments와 Graph(13.7초), 기존 Mention Rename/Backlinks/Slash/Todo 변환(12.9초)의 E2E 3개 통과. Graph 글자/Touch 대상은 확대율과 별도로 크기를 유지하고 키보드로 선택한 문서를 화면 안에 표시한다. Source `34bc93eee53a110a7c023d79e65cebea2838c74b`의 [CI 37552924850](https://github.com/GUnT0x9/ZeroNote/actions/runs/37552924850)에서 lint/type-check/440 Tests/26 E2E(3.1분)/build/서버 Docker/512MiB 기동/8 Migrations/16개 Table 암호화 백업 복원이 통과했다. 1,000 Pages·1,000 Rows·500 Blocks의 기존 캐시 문서/검색 성능 회귀도 통과했다. 실제 Android Chrome/iOS Safari 기기 검증은 미실시다.

## Production 증거

- Render `dep-db2pce7lk1mc7388jo4g` Live → Vercel `dpl_AE4bWzSwT5m9qy9BTNXaqZ5qm8Vz` READY를 같은 `34bc93e` 소스로 배포했다. Production Alias/Project ID와 `zeronoteCommit`/`githubCommitSha`를 Vercel API에서 확인했다. 새 Migration이나 환경변수는 추가하지 않았다.
- 배포 전 PostgreSQL 17 암호화 백업을 생성하고 최근 4개 보관을 확인했다. 실제 HTTPS 검증 후 Migration 8개, Protocol 1–4, Checkpoint에 대응하는 source Index 누락 0건, DB 11,255,808 bytes, QA Workspace 0개다.
- [Beta](https://zeronote-kohl.vercel.app)의 5개 Browser 흐름이 통과했다(2.9분): 새 기기 미열람 Graph/Backlinks·관련 Tag 근거·키보드/목록/확대/Pan·Trash 상태·Offline 링크 교체/Reload/두 기기 수렴(41.0초), 전체 검색·Tag/Property·미전송 변경(32.4초), 두 기기 Realtime·Comments·Viewer·Recovery(29.8초), Mobile Touch 편집/Capture/Comments/Graph(19.4초), File/Formula/Relation/Rollup·Rename·권한 철회·Offline Reload·Snapshot(36.9초).
- 최종 소스는 서버 미전송 제목도 허용된 Overlay에서 표시하고 Viewer의 Overlay는 무시한다. 부분 접근 기기의 Graph 개수/관련 문서/Backlinks/문제 목록에 범위 밖 문서 이름을 포함하지 않는 서버 회귀를 함께 확인했다.
- 실제 모바일 기기는 별도로 검증해야 한다. 이번 Mobile 결과는 HTTPS Chromium의 Touch·390×844 viewport 검증이며 Android Chrome/iOS Safari 실기기 결과로 표현하지 않는다.

## 변경 파일과 이유

| 파일                                                                                                                                                                       | 변경 이유                                                               |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `packages/shared/src/knowledge-graph.ts`, `knowledge-replacement.ts`, `index.ts`                                                                                           | 연결/추천/상태 Schema·공유 계산·명시적인 CRDT 링크 교체                 |
| `apps/server/src/database/search-store.ts`, `knowledge-service.ts`, `knowledge-routes.ts`, `routes.ts`                                                                     | 본문 전체를 내보내지 않는 source head 조회·현재 권한/제한 검사·읽기 API |
| `apps/web/src/lib/knowledge.ts`, `use-knowledge.ts`, `graph-layout.ts`, `linked-page.ts`, `search.ts`, `http.ts`                                                           | 로컬 연결·전송 대기 수정·취소/재시도·Graph 위치·독립된 하위 Page 접근   |
| `apps/web/src/components/knowledge-panel.tsx`, `knowledge-graph.tsx`, `link-replacement.tsx`, `context-panel.tsx`, `editor-nodes.tsx`, `primitives.tsx`, `app/globals.css` | 기존 Panel에 연결 UX·Graph·교체·대상 이름 보호·Focus/Touch 조작         |
| shared/server/web의 관련 `*.test.ts`, `tests/workspace.spec.ts`                                                                                                            | 계산·상태·동시 요청·저장·권한·Offline와 새 기기 브라우저 회귀           |
| `docs/api.md`, `knowledge-release.md`                                                                                                                                      | API/범위·검증·배포 증거                                                 |
