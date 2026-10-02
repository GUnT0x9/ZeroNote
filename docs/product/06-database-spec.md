# Task Database 명세

Status: Accepted Alpha specification

Alpha Database는 Task 전용 고정 Schema다. Row ID는 UUID이며 제목, 본문, Status, Assignee Identity ID, Due Date, Priority를 가진다.

Status: todo / in_progress / done. Priority: low / medium / high, 기본 medium. Assignee와 Due Date는 미지정 가능하다. Due Date는 YYYY-MM-DD이며 Date 객체의 시간대 변환을 거치지 않는다.

Table과 Board는 같은 Y.Map Row를 읽는다. 서로 다른 Property 변경은 독립적으로 병합한다. 같은 Property의 동시 변경은 Yjs의 결정적인 충돌 결과를 사용한다. Board Column 이동은 Status 변경이다.

Row 제목은 Y.Text, Property는 Row별 Y.Map, 본문은 해당 Database Y.Doc의 task:<rowId> Fragment다. Row는 Database 권한을 상속한다. Row별 Share와 Database 사이 Row 이동은 Alpha 밖이다.

Table은 제목·Status·Assignee·Due Date·Priority 편집과 Row 열기를 제공한다. Board는 Status별 Group과 Drag/Drop·Keyboard 변경을 제공한다. 필터와 제목 검색은 로컬에서 동작한다.

Todo 변환 시 첫 번째 접근 가능한 편집 가능 프로젝트에 Row를 생성하고 원래 Todo를 Task Link로 변경한다. Owner에게 프로젝트가 없다면 프로젝트를 생성하고, 공유 Editor에게 프로젝트가 없다면 안내 후 Todo를 유지한다. Offline에서도 동일하게 Local 저장하고 Online 복구 후 전송한다. 일반 Property Builder, Formula, Relation, Rollup, 추가 View는 Deferred다.

## 기능 계약

| Trigger    | Behavior                                | Offline               | Sync                      | Error                        | Acceptance Criteria              |
| ---------- | --------------------------------------- | --------------------- | ------------------------- | ---------------------------- | -------------------------------- |
| 새 Task    | UUID Row와 기본 Property 생성           | 즉시 Local 작성       | Row별 Y.Map               | 빈 제목 입력은 생성하지 않음 | Table·Board에서 같은 Row 표시    |
| Table Cell | 제목/Status/Assignee/Date/Priority 변경 | Local 편집            | 서로 다른 Field 독립 병합 | 유효하지 않은 Date 거절      | 날짜가 시간대에 따라 변하지 않음 |
| Board 이동 | 대상 Column으로 Status 설정             | Local 변경            | Status Field 병합         | 읽기 전용에서 쓰기 UI 비활성 | Table Status도 변경              |
| 상세 열기  | `task:<rowId>` 본문과 Properties        | 이미 Cache된 Database | 같은 Database 문서        | 삭제된 Row는 열 수 없음      | 상세 제목·Property가 View와 일치 |
| Task 삭제  | deleted=true                            | Local Soft Delete     | Row Field 병합            | 권한 없는 변경 차단          | Table·Board에서 함께 숨김        |

Table은 25 Rows 단위 Pagination과 로컬 검색을 사용한다. Board에는 Pointer Drag/Drop와 Status 선택을 제공한다. 프로젝트 초대는 Row와 본문을 포함하며 Row별 권한을 만들지 않는다. 프로젝트 Page Comments는 Database 단위 Thread다. Row별 Comment Scope와 Row 이동 정책은 후속 확장이다.

## P0 일반 Database 확장 (2026-10-02)

Accepted. 기존 `tasks` Y.Map Row 저장 형식을 재사용한다. 일반 Database는 `databaseConfig.mode=generic`으로 구분하며 Task 고정 속성은 노출하지 않는다. 사용자 정의는 `databaseProperties`의 속성별 Y.Map, 사용자 값은 Row의 `property:<UUID>`, Saved View는 `databaseViews`의 View별 Y.Map이다. 제목 Y.Text와 본문 `task:<rowId>`를 유지한다.

| Trigger              | Behavior                              | Offline        | Sync                      | Error                            | Acceptance Criteria            |
| -------------------- | ------------------------------------- | -------------- | ------------------------- | -------------------------------- | ------------------------------ |
| 속성 추가/변경/삭제  | 13종, 64개, 이름 변경/Soft delete     | Local 작성     | 속성 필드별 Y.Map         | 잘못된 정의/개수 제한 거절       | 기존 셀 값 보존                |
| Cell/상세 입력       | 타입 검증, 자동 시간 readonly         | Local 작성     | Row 필드별                | 값 오류를 해당 Cell에 표시       | Table/상세/Board 데이터 일치   |
| Filter/Sort/Group    | AND Filter 20개, Sort 5개, 선택 Group | Local Query    | Saved View 필드별         | 삭제 속성은 적용 해제            | 일치 Row를 중복/누락 없이 표시 |
| Calendar/Timeline    | 날짜 전용 월 탐색/기간                | Cache된 문서   | 같은 Row 값               | Date 속성 미선택 안내            | 날짜 없는 Row 별도 노출        |
| Gallery/List         | 제목/실제 속성 표시와 Row 열기        | Cache된 문서   | 같은 Row                  | 삭제된 Row 제외                  | 같은 상세 화면으로 이동        |
| 보기 저장            | 이름·종류·조건·날짜·표시 속성, 20개   | Local 작성     | View 필드별               | Viewer 쓰기 금지, 개수/정의 검증 | Reload 후 설정 유지            |
| Export/Snapshot 복구 | Schema/View/값/Row 본문 복사          | Export는 Local | Snapshot은 Commit 완료 후 | 기존 실패 보존 정책              | 새 비공유 문서와 원본 독립     |

File Property, 선택 옵션 편집, 타입 변환, Formula/Relation/Rollup은 Deferred다. 전체 계약과 검증은 `docs/database-release.md`를 따른다.
