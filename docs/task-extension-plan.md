# Task 확장 구현 기준

2026-10-07 Accepted implementation defaults. 기존 미완료 Task 기능을 계속 구현한다. 이 문서는 완료 증거가 아니며 기능 체크는 UI·저장·권한·Offline·CI·실제 HTTPS를 확인한 후 변경한다.

## 다음 구현 묶음

Subtask, Task Dependency, Task Label/Tag, Task Estimate, Task Template의 5개를 먼저 연결한다. 기존 Task 전용 Database의 Row ID·Row 본문·Table/Board·상세 화면과 권한을 재사용한다. 일반 Database의 사용자 정의 Property와 별개의 Task 기능이며 기존 문서를 자동 변환하지 않는다.

| Trigger                                    | Behavior                                                                                                                                                     | Offline                 | Sync                                                    | Error                                                                                                              | Acceptance Criteria                                                                                      |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| Task 상세의 하위 작업 추가/부모 선택       | 같은 Database의 Task ID로 부모를 연결한다. 상세에는 하위 작업 목록과 부모 이동을 제공하고 View에서는 별도 Task로 유지한다.                                   | 로컬 생성·관계 수정     | Row별 부모 필드, 서로 다른 Row 병합                     | 자기 자신·순환·다른 Database 참조를 거절한다. 부모 삭제는 하위 작업 삭제로 전파하지 않고 관계 상태를 표시한다.     | 상세·Table·Board의 Row 일치, 부모 이름 변경 유지, 부모 삭제 후 자식 본문 보존                            |
| Task 상세의 선행 작업 선택                 | 같은 Database의 선행 Task ID를 추가/해제하고 미완료 선행 작업을 표시한다.                                                                                    | 로컬 편집               | 연결별 CRDT 항목, 다른 연결 동시 변경 보존              | 자기 자신·순환·누락 참조 상태를 표시하고 새 잘못된 연결을 거절한다. 선행 작업이 남은 완료 처리는 확인 후 적용한다. | 선행 작업 완료/삭제에 상태 갱신, 이름 변경 뒤 연결 유지, 동시 추가 순환 발견 및 수동 해제 가능           |
| Task Label 편집                            | Task별 Label 추가·이름 변경·삭제와 Label 필터, 상세/목록 표시                                                                                                | 로컬 편집·필터          | Label별 CRDT Map, Page Tag와 같은 정규화·개수/길이 제한 | 빈 Label·한도 초과 거절, 기존 다른 Label 보존                                                                      | 두 기기에서 다른 Label 추가 병합, Reload·Snapshot·Export/Import 보존                                     |
| Task Estimate 입력                         | 분 단위 정수로 저장하고 시간/분 입력과 읽기 표시를 제공한다. 미지정과 0을 구분한다.                                                                          | 로컬 입력               | Row별 값                                                | 음수·소수 분·범위 밖 입력을 저장하지 않는다.                                                                       | 상세·Table 데이터 일치, 시간 입력 변환 정확, 서로 다른 속성의 동시 수정 보존                             |
| Task를 Template으로 저장/Template에서 생성 | 같은 Database에 이름과 Task 기본 속성·본문을 저장한다. 새 Row/본문을 만들고 상태는 Todo, 날짜는 미지정으로 시작한다. 부모·Dependency는 자동 복제하지 않는다. | Template 저장·조회·생성 | 같은 Database 문서의 Template 정의와 독립된 새 Task     | 권한·Template 개수·본문 크기 확인, 삭제/동시 변경된 Template은 재조회 안내                                         | 새 Task와 원본의 편집 독립, 파일 참조·문서 링크 보존, Viewer 쓰기 차단, Snapshot·복제·Export/Import 보존 |

## 실패·호환 규칙

- 관계는 표시 이름 대신 안정적인 Row ID를 사용한다. Database 권한을 상속하며 Row별 Share나 접근 권한 전파를 추가하지 않는다.
- 변경 성공 표시는 기존 Local 저장 확인과 PostgreSQL Commit 확인을 따로 사용한다. 잘못된 입력은 CRDT를 변경하기 전에 확인한다.
- 서로 다른 기기의 유효한 변경을 합친 뒤 순환/한도 초과가 생기면 원본을 보존하고 해당 관계를 해제하는 UI를 제공한다. 임의로 연결이나 본문을 삭제하지 않는다. 서버 검증 실패는 기존 보존 정책을 따른다.
- 기존 Row에는 새 필드의 빈 기본값을 적용한다. 기존 Task 생성·Todo 변환·일반 Database·검색 Projection·Public 읽기·Template 복제·Snapshot/Import의 영향을 함께 검사한다.
- 새 함수는 happy path와 edge case를 검증한다. 의미 있는 CRDT 동시 변경·삭제/권한·Offline Reload·재접속 브라우저 회귀를 추가하고 전체 검증 후 Render → Vercel에 배포한다.

## 이후 묶음

Task별 Comment Thread와 Task별 Comment 요구는 같은 Row Scope로 연결하고 Page Thread를 유지한다. 그다음 Task Activity Log와 Member/Mention/Notification 기반을 연결한 뒤 Recurring Task·Task Reminder를 구현한다. 반복 생성은 안정적인 Operation ID와 기간별 중복 방지가 필요하다. 알림과 반복 실행 시점은 Render Free의 절전 조건과 Offline 상태를 구분해 UI에 표시하며 유휴 DB Polling이나 서버를 깨워 두는 요청을 추가하지 않는다. 이 후속 기능들도 전체 완료 대상이다.
