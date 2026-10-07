# Task 확장 구현 기록

2026-10-07 구현·배포·실제 HTTPS 검증 완료. 기존 미구현 29–32, 37번: Subtask, Dependency, Label/Tag, Estimate, Task Template. 검증된 완료는 58/148이며 나머지 90개는 계속 구현 대상이다.

## 동작과 저장

- Task 상세에서 상위/하위 작업과 선행 작업을 연결하고 이동한다. Table/Board는 같은 Row를 표시한다. 이름 변경에도 Row ID를 유지하며 부모 삭제는 자식이나 본문을 삭제하지 않는다. 삭제된 연결은 상태를 표시하고 해제할 수 있다.
- 부모/Dependency의 자기 참조·순환·같은 Database에 없는 새 연결을 변경 전에 거절한다. 두 기기의 유효한 변경이 합쳐져 순환/한도 초과가 생기면 Row를 유지하고 상세에서 해제한다. PostgreSQL은 잘못된 상태를 422로 거절하고 클라이언트는 로컬 수정과 복구 UI를 유지한다. 미완료 선행 작업이 있는 Done 변경은 확인을 요구한다.
- Label 추가·이름 변경·삭제, 정규화된 정확한 Label 필터, Table/Board 표시와 전체 검색을 제공한다. 기존 Page Tag와 같은 Unicode 정규화/길이 규칙을 따른다. Row별 최대 30개, 선행 작업 최대 50개이며 동시 한도 초과는 읽기/수정을 막지 않고 서버 Commit에서 확인한다.
- Estimate는 분 단위 정수, 미지정과 0을 구분한다. 분·시간/분 및 소수 시간 입력을 지원하며 음수·소수 분·범위 밖은 변경 전에 거절한다. 최대 365일이다.
- 같은 Database에 이름을 붙여 Task 속성·본문을 Template으로 저장하고 독립된 새 Task를 만든다. 새 Task는 Todo, 기본 날짜 미지정, 부모/Dependency 없음으로 시작한다. Priority/Assignee/Estimate/Label과 사용자 정의 수정 가능 속성은 복사한다. Formula/Rollup/자동 시간은 새 Row에서 계산한다. Template은 최대 20개이며 이름 변경·삭제와 독립된 읽기 전용 미리보기를 제공한다.
- Template 저장 이후 삭제/종류/Relation 대상/선택 옵션이 바뀌면 Task를 부분 생성하지 않는다. 변경된 속성 이름을 표시하고 사용자 확인 후 그 속성만 제외한다. 기존 Template은 유지한다. 생성 후 로컬 저장 실패의 재시도는 같은 Row를 저장하며 다른 공동 편집자의 Row를 선택하지 않는다.
- 본문 파일과 File Property는 Template에만 남아도 영구 정리로부터 보호한다. Public에는 사용하지 않는 Template 파일을 포함하지 않는다. Snapshot/복제/Import에서 파일 ID와 Relation 대상 Database ID를 재매핑하고 자기 Task Link/Relation은 새 Task 생성 시 새 Row ID로 바꾼다. 원본 상태는 변경하지 않는다.
- 새 REST API/Migration/환경변수는 추가하지 않는다. Database 권한과 기존 REST/WebSocket Commit, Operation ID·Checkpoint·Commit 이후 저장 표시를 재사용한다. Viewer 본문/Task/Template 쓰기를 차단한다. Offline 저장/새로고침/재접속과 Recovery도 같은 Database 문서로 동작한다.

## CRDT 계약

서버도 알 수 없는 Row ID/다른 Database의 새 참조를 거절한다. Snapshot/복제에서는 활성 Task가 참조하는 삭제된 Row의 ID와 삭제 표시만 보존해 관계를 구분하고 삭제된 Row의 제목·본문·파일은 복사하지 않는다. 새 기본 속성은 `Estimate (분)`으로 표시하여 기존 사용자 정의 `Estimate`와 입력 라벨을 구분한다.

`TaskRow`는 기본값이 있는 `parentTaskId:null`, `estimateMinutes:null`, `dependencyIds:[]`, `labels:[]`를 더한다. 실제 Label/Dependency는 각각 `task-labels:<rowId>`와 `task-dependencies:<rowId>`의 최상위 Map에 연결별로 저장한다. 기존 Row의 첫 동시 편집에서 새 중첩 Map 두 개가 충돌해 한 기기의 연결 전체가 사라지는 일을 피한다. 제목/속성/Row 본문은 기존 원본을 유지한다.

`taskTemplates` Map은 UUID별 정의, `task-template:<id>`는 저장한 독립 XML 본문이다. 정의에는 캡처한 사용자 정의 Property Schema와 값이 포함된다. 삭제는 정의에 표시하고 Template 본문을 제거하며 이미 생성한 Task를 유지한다. 기존 Template 정의는 빈 사용자 정의 속성 기본값으로 읽는다. Source 검색 Projection은 Row Label/관계/Estimate를 반영하고 Template 본문이나 비공개 파일 이름은 검색/공개 원본에 추가하지 않는다.

## 검증

첫 CI의 lint/type-check/460 Tests/build와 26 E2E는 통과했으나 기존 Custom Property의 `Estimate`와 새 기본 `Estimate` 입력의 중복 라벨이 strict locator에서 발견됐다. 단위가 있는 기본 이름으로 구분하고 해당 Viewer/Snapshot 회귀를 포함한 재검증을 통과했다. 이 실패한 CI 결과로 배포하거나 완료로 표시하지 않는다.

Template 보강 초기 로컬 전체 460 Tests/54 files 통과(143.35초), lint/type-check와 Web/Server build 통과. 동시 실행 시 Beta 초기화 Hook의 10초 timeout으로 6개가 실행되지 않은 첫 결과를 기록하고, 동시 Test Worker를 4개로 제한한 전체 재실행에서 모두 통과했다. Template 보강 집중 27 Tests와 서버 Commit/파일 보호/새 ID Snapshot 복구 3개도 통과했다. 최종 Task Offline 생성/Reload·독립 본문/사용자 정의 값/File 복사·두 기기 Label 병합·Cycle 거절·Board/필터·Snapshot 브라우저(32.7초), 기존 File/Formula/Relation/Rollup·Rename/Offline/권한 철회/Snapshot(26.7초) 통과. Mobile Touch 17.0초 통과 후 최종 CI와 Production 결과는 아래에 기록했다. 실제 Android Chrome/iOS Safari 검증은 미실시다.

## Production 증거

- Source `bee64d1aaa3bc7617096c1abeb102cd07616386a`의 [CI 37559660137](https://github.com/GUnT0x9/ZeroNote/actions/runs/37559660137)에서 lint/type-check/460 Tests/27 E2E(3.2분)/Web·Server build/서버 Docker/512MiB 기동/8 Migrations/16개 Table 암호화 백업 복원이 통과했다. 1,000 Pages·1,000 Rows·500 Blocks의 캐시 열기/검색 성능 회귀도 통과했다.
- Render `dep-db2qi20m7kps73builtg` Live → Vercel `dpl_F9cm2TfHshTaQqgR9yxvNp11tMKh` READY를 같은 `bee64d1` 소스로 배포했다. Production Alias/Project와 `zeronoteCommit`/`githubCommitSha`를 API로 확인했다. 새 환경변수나 Migration은 추가하지 않았다.
- 배포 직전 PostgreSQL 17 암호화 백업과 최근 4개 보관을 확인했다. 실제 HTTPS 검증 후 Migration 8개, Protocol 1–4, source Index 누락 0건, DB 11,345,920 bytes, QA Workspace 0개다.
- [Beta](https://zeronote-kohl.vercel.app)의 7개 흐름이 통과했다(3.5분): Task 확장·사용자 정의 값/File Template 복사·Offline Reload/두 기기 수렴/순환 거절/Board/필터/Snapshot(33.4초), Graph·관련 문서·링크 교체(34.7초), 전체 검색·미전송 변경(29.5초), Realtime·Comments·Viewer·Recovery(25.5초), Mobile Touch 편집/Capture/Comments/Graph(16.6초), File/Formula/Relation/Rollup·권한/Offline/Snapshot(33.1초), 기존 사용자 정의 Estimate·Viewer·Snapshot(23.5초).
- Mobile 결과는 HTTPS Chromium Touch·390×844 viewport 검증이다. 실제 Android Chrome/iOS Safari 기기 검증은 미실시다. 이후 Task별 Comments/Activity/Recurring/Reminder와 전체 미완료 요구도 계속 구현한다.

## 변경 파일과 이유

CI 실패 보강 후 최종 로컬 전체 460 Tests/54 files 통과(130.48초), lint/type-check 통과. 새 Task 흐름(26.8초), Mobile Touch(16.5초), 기존 File/Formula/Relation/Rollup(23.8초), 기존 사용자 정의 Estimate의 Viewer/Snapshot(15.4초) 브라우저 4개가 모두 통과했다. 같은 Database에 없는 Parent/Dependency의 서버 거절과 삭제된 부모의 내용 없는 Snapshot 복구/재Commit을 회귀에 추가했다. 최종 CI와 실제 배포 검증도 아래와 같이 통과했다.

| 파일                                                                                                                                                                                                                 | 변경 이유                                                                       |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `packages/shared/src/task-schema.ts`, `task-extension.ts`, `task-templates.ts`, `xml.ts`                                                                                                                             | 입력/CRDT 관계·동시 충돌·Template/독립 XML 복제 계약                            |
| `packages/shared/src/index.ts`, `database.ts`, `knowledge-projection.ts`, `search-engine.ts`, `attachments.ts`, `editor-protocol.ts`                                                                                 | 기존 Row 호환·Property/검색·파일 보호·Snapshot/Import/Protocol 연결             |
| `apps/server/src/database/document-store.ts`                                                                                                                                                                         | REST/WebSocket 공통 Commit의 관계/Template 검증과 로컬 복구 안내                |
| `apps/web/src/components/task-details.tsx`, `task-estimate.tsx`, `task-templates.tsx`, `task-database.tsx`, `database-property.tsx`, `document-view.tsx`, `history-panel.tsx`, `app/globals.css`, `lib/workspace.ts` | 상세/Table/Board/Template/미리보기·Mobile·Import 사용 흐름                      |
| `packages/shared/src/task-extension.test.ts`, `apps/server/src/integration.test.ts`, `tests/workspace.spec.ts`                                                                                                       | 동시 첫 편집·순환/한도·저장/Viewer·Template 파일 보호/복구·Offline/두 기기 회귀 |
