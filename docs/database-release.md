# Database 확장과 배포 검증

2026-10-02. 사용자 기능 체크리스트와 실제 코드를 대조하고 남은 P0 Database 항목을 구현한다. 작업 브랜치는 `codex/database-views`이며 이전 메인 UI 개편을 포함한다.

## 동작

- Sidebar의 새 Page 메뉴에서 일반 Database를 생성한다. 기존 Task Database는 유지하며 자동 변환하지 않는다.
- `속성`에서 Text, Number, Select, Multi select, Status, Date, Checkbox, Person, URL, Email, Phone, Created time, Updated time을 추가한다. 사용자 속성 최대 64개다. 이름 변경과 삭제를 제공하고 삭제된 속성 값은 문서 안에 보존한다. 타입 변경과 선택 항목 편집은 이번 범위에 없다.
- Table과 항목 상세에서 속성을 편집한다. Number/URL/Email은 Blur/Enter에서 검증하고 잘못된 값은 저장하지 않는다. 자동 시간은 읽기 전용이다. 기존 시간 정보가 없는 Row는 빈 시간으로 표시한다.
- Filter는 최대 20개 AND 조건, Sort는 최대 5개이며 빈 값은 뒤에 둔다. Table/Board/Gallery/List에서 Group을 사용한다. Board의 Select/Status/Person/Checkbox Group 이동은 실제 해당 속성을 바꾼다.
- Calendar는 날짜 속성의 월별 항목과 날짜 없는 목록, Timeline은 시작/종료 날짜의 기간과 월 탐색을 제공한다. 날짜 전용 문자열로 위치를 계산한다. 종료 날짜가 시작 이전이면 시작일 하나로 표시한다.
- Gallery는 실제 제목과 속성을 카드로 표시한다. 파일 업로드와 이미지 Cover는 포함하지 않는다. List도 같은 Row를 표시한다.
- 보기 이름과 종류·Filter·Sort·Group·날짜 속성·표시 속성을 문서에 저장한다. 최대 20개이며 이름 변경과 삭제가 가능하다. Viewer/Commenter의 임시 탐색 설정은 문서에 쓰지 않는다.
- 기존 Task에 Start Date/End Date/Created time/Updated time을 추가한다. 기본 Table 열은 기존과 같으며 표시 속성에서 추가한다.

## Offline, 동기화, 권한, 복구

Row, 사용자 속성 정의, Saved View 모두 같은 Yjs 문서에 보관한다. 열어 저장한 문서는 Offline 편집·Reload·재접속 병합을 지원한다. 서로 다른 셀과 정의/보기의 서로 다른 필드는 독립적으로 병합한다. 같은 필드 동시 변경은 Yjs의 결정적인 충돌 결과를 따른다. Viewer/Commenter는 쓰기 UI를 제공하지 않으며 서버의 기존 문서 단위 권한 검사를 유지한다.

Export/Import는 기존 version 1 Yjs 문서에 추가 필드를 포함한다. Snapshot 복구는 사용자 속성·모드·보기·Row 값·Row 본문을 새로운 CRDT 문서로 복제하며 접근 권한을 복사하지 않는다. 기존 Page Metadata/API/DB Migration은 호환된다. 파일 업로드, Formula/Relation/Rollup, Public Share, 전체 모바일 편집은 후속이다.

## 변경 파일

| 파일                                                                                   | 이유                                                                            |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `packages/shared/src/database.ts`, `index.ts`                                          | 공유 속성/View Schema, 값 검증·Query·Group·날짜 계산, 기존 Row 호환과 복구 복제 |
| `components/task-database.tsx`                                                         | 기존 Task Table/Board를 일반 Database와 Saved View로 확장                       |
| `components/database-property.tsx`, `database-settings.tsx`, `database-date-views.tsx` | 공통 Cell/상세, 속성/보기 설정, Calendar/Timeline/Gallery/List                  |
| `components/document-view.tsx`, `context-panel.tsx`, `history-panel.tsx`               | 상세·Properties·Snapshot 미리보기에서 사용자 속성 제공                          |
| `components/sidebar.tsx`, `workspace-app.tsx`, `lib/workspace.ts`                      | 일반 Database 생성과 Offline 초기화                                             |
| `app/globals.css`                                                                      | 기존 Figma 메인 Tokens를 사용하는 View와 모바일 탐색 배치                       |
| `packages/shared/src/database.test.ts`, `tests/workspace.spec.ts`                      | 검증, Offline 병합, View/복구/권한과 기존 흐름 회귀                             |
| `docs/feature-checklist.md`, 제품 명세/Decision Log                                    | 실제 구현과 후속 범위를 구분                                                    |

## 검증과 배포

최종 검증 및 Production 배포 결과는 아래에 기록한다. 배포는 CI 통과 Commit으로 Render → Vercel 순서다. DB Schema를 되감지 않는다.

- 로컬 `lint`, `type-check`, `test`, `build`: 통과. Unit/Server 128개.
- 기존 브라우저 흐름 11개와 일반 Database Offline/View 시나리오를 포함한 전체 12개를 로컬과 동일 Commit의 CI에서 통과했다. CI의 Docker/암호화 백업·복원도 통과했다.
- 성능 Fixture(1,000 Pages/500 Blocks/1,000 Tasks): 최종 로컬 전체 검증에서 캐시 문서 열기 283ms, Local Search 22ms.
- 배포 전 Production DB의 PostgreSQL 17 + age 암호화 백업 완료. Key/백업은 Git 밖에 보관한다.
- 실제 Android Chrome/iOS Safari 기기 검증은 미실행이며 Chromium Touch Viewport로 기존 Mobile 흐름을 확인했다.

## Production 배포 결과

| 항목           | 검증 결과                                                                                                                                  |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 앱 Commit      | `4b07123f6558ec078f3173815b1e82ee7034e4be`                                                                                                 |
| CI             | [36948621839](https://github.com/GUnT0x9/ZeroNote/actions/runs/36948621839) success. 128 Tests/12 E2E/Build/Docker 512MiB/암호화 백업·복원 |
| 로컬 전체 E2E  | 최종 12개 통과. Calendar/Timeline에 적용되지 않는 Group 도구가 표시되지 않는 것도 확인                                                     |
| Render         | `dep-davg5gtg1s2s73acvs20` live. 같은 Commit, Health 정상                                                                                  |
| Render 설정    | `codex/database-views`, `autoDeploy=no`, `autoDeployTrigger=off`                                                                           |
| Vercel         | `dpl_ANsVUuXFkgjcgq9Phb99gYh8Eggd`, Production READY. Metadata의 Commit/Branch 일치                                                        |
| Web            | https://zeronote-kohl.vercel.app · 고정 Production Alias 유지                                                                              |
| 배포 순서/소스 | Render → Vercel. Git archive의 추적 파일 164개/약 3MiB만 업로드. 로컬/인증/테스트 결과 제외                                                |
| 실제 HTTPS     | 11개 동작 흐름 확인. 10개 최초 통과 + Snapshot 완료 대기 조건 보강 후 해당 시나리오 통과                                                   |
| 기존 데이터    | 새 브라우저 Recovery, 문서/Task/Comments/Snapshot 유지, 기존 Viewer 쓰기·기록 조회 차단 확인                                               |
| Origin         | 잘못된 Origin의 POST는 403, 직접 WebSocket 연결은 거절                                                                                     |

Production QA는 운영자 CLI로 별도 테스트 코드를 발급해 새 테스트 Workspace에서 실행했고 종료 시 해당 Workspace를 삭제했다. 기존 검증용 샘플은 유지했다. 다른 사용자 Workspace는 수정하지 않았다.

운영 환경의 지연으로 Snapshot 복구 요청 직후 원본과 미리보기의 동일 필드를 잡은 테스트를 보강했다. 기록 Panel이 닫히고 복구 Page의 고유 제목이 표시된 뒤 결과를 검증한다. 외부 환경의 운영용 Beta CLI 설정 대기는 90초로 하고 로컬은 기존 15초를 유지한다. 이 후속 변경은 Test/문서만이며 배포된 앱 소스는 위 Commit과 같다.

실제 Android/iOS 기기와 무료 서비스의 장시간 Sleep 이후 수동 사용은 별도 확인 항목으로 유지한다.
