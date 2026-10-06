# Knowledge·Search·Tags 구현 기준

전체 미완료 22–28, 70–71번의 9개 항목을 다음 묶음으로 구현한다. Database 속성 묶음의 CI·Production 검증을 완료한 뒤 적용한다. 이 문서는 구현 기준이며 완료 증거가 아니다.

## 범위와 데이터 책임

- 기본 검색은 현재 Workspace이며 모든 접근 가능한 Workspace를 선택할 수 있다. 제목·문서 본문·Task 제목/본문·검색 가능한 속성·Tag를 대상으로 한다. 로컬 결과를 즉시 보여주고 Online에서는 아직 이 기기에 열지 않은 문서도 서버 검색으로 찾는다.
- 서버 Index는 Commit된 CRDT에서 파생한다. 본문 편집 원본을 만들지 않으며 문서 Commit과 같은 Transaction에서 갱신한다. Migration과 기존 문서의 Index 준비가 끝난 후 Ready로 표시한다.
- Index에는 문서에 직접 저장한 검색 값만 포함한다. Relation 대상 이름과 Formula/Rollup 결과는 현재 요청자의 접근 범위로 계산한다. 다른 사용자의 계산 결과를 공통 Index나 영속 검색 Cache에 저장하지 않는다.
- 권한은 검색·Graph·추천 요청마다 서버 Metadata/Grant 기준으로 검사한다. Trash와 그 하위 Page, 철회된 접근을 제외한다. 필터·추천·Graph의 개수와 이름에도 같은 범위를 적용한다.
- Tag는 Page의 CRDT Metadata로 관리한다. Unicode NFKC·공백 정리·대소문자를 통일한 Key를 사용하고 표시 이름은 유지한다. Page당 최대 30개, 표시 이름 최대 64자로 시작한다. 같은 Tag 추가의 중복을 막고 Offline 수정·동시 수정·문서 복제·Snapshot·Export/Import를 지원한다.

## 기능 계약

| 기능                    | Trigger                         | Behavior                                                                      | Offline                          | Sync                                                                  | Error                                          | Acceptance Criteria                                                 |
| ----------------------- | ------------------------------- | ----------------------------------------------------------------------------- | -------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------- |
| Global Full-text Search | Sidebar Search / Cmd·Ctrl+K     | 제목·본문·Task·직접 저장한 속성을 검색, 제목 우선 정렬과 근거 Snippet         | 저장된 문서 검색, 로컬 범위 표시 | Online 결과와 로컬 수정 병합, 서버 결과가 미전송 수정을 덮어쓰지 않음 | 서버 실패 시 로컬 결과 유지                    | 새 기기에서 열지 않은 접근 가능 문서를 검색; 비공유 문서 제외       |
| Search Filter           | Search 필터                     | Workspace·문서/Database·Tag·수정 기간을 조합, 초기화 제공                     | 동일 필터                        | 최신 접근 범위 적용                                                   | 잘못된 날짜·연산자를 입력 위치와 함께 표시     | 검색 UI와 연산자 입력이 같은 결과를 제공                            |
| Search by Property      | 속성 조건 추가                  | Database의 기본/Custom 속성을 선택해 형식에 맞는 조건 적용                    | 캐시된 대상 값 계산              | Formula/Rollup은 요청자 범위로 계산                                   | 누락/접근 불가/형 오류를 구분                  | Table과 검색에서 같은 속성 값/조건 결과                             |
| Knowledge Graph         | 연결 Panel에서 Graph 열기       | Page Mention·Task Link·Relation 연결, 선택 Page 중심 탐색·확대·축소·목록 대체 | 로컬 문서 연결                   | Online Index의 허용된 연결 병합                                       | 큰 Graph는 표시 범위를 제한하고 추가 탐색 제공 | 키보드로 선택/이동, 삭제·철회 대상과 이름을 표시하지 않음           |
| Related Pages           | 연결 Panel의 관련 문서          | 직접 연결·공통 Tag·본문 단어 겹침의 결정적 점수로 추천, 추천 근거 표시        | 로컬 추천                        | Online 검색 Index의 접근 가능한 후보 사용                             | 후보 없음은 빈 상태                            | 동일 데이터에서 순서 재현, 자기 자신/Trash/권한 밖 제외             |
| Broken Link 탐지        | 연결 Panel의 링크 상태          | 알려진 삭제/누락과 접근 확인 불가를 구분, 원문 링크 유지                      | 확인 가능한 로컬 상태만 표시     | Online에서 허용된 대상 상태 확인                                      | 접근 불가 대상을 삭제로 단정하지 않음          | 끊긴 연결을 찾고 이동/교체 가능, 대상의 비공개 이름을 노출하지 않음 |
| Tag 시스템              | Page Properties / 검색 Tag 필터 | 추가·제거·이름 정리, 문서와 Database 모두 지원                                | 즉시 Local 저장                  | CRDT 병합과 서버 검증                                                 | 개수/길이/권한 오류 시 입력 보존               | 새로고침·두 기기·복제/복구/Import에서 Tag 유지                      |
| Fuzzy Search            | Search 검색어                   | 정확/접두/부분 일치를 우선하고 제한된 오타 후보를 후순위 표시                 | 같은 제한된 계산                 | 서버/로컬 동일 정규화·점수 규칙                                       | 긴 입력과 후보 수에 계산량 제한                | 한 글자 오타와 한글 정규화 회귀, 정확 결과가 오타 후보보다 앞섬     |
| Search Operators        | Search 입력                     | 따옴표 구문·제외어·명시적인 type/tag/workspace/property 조건                  | 동일 파서                        | 공유 AST로 서버 요청                                                  | 알 수 없는 연산자·미닫힌 따옴표는 실행 전 오류 | UI 필터와 같은 AST, 임의 SQL/코드 실행 없음                         |

## 주요 흐름

검색은 입력 → 로컬 결과 → 선택한 범위의 Online 결과 병합 → 문서 열기 순서다. 빈 입력에는 최근 문서와 기존 Command 모드를 유지한다. 필터 변경과 새 입력은 이전 응답을 취소하거나 버려 오래된 결과가 덮어쓰지 않게 한다. 서버 Cache에는 접근 범위를 포함하며 권한 철회 이벤트에서 검색/Graph/추천 상태를 갱신한다.

Tag는 Properties에서 추가 → 로컬 저장 → 검색/연결 화면 갱신 → 서버 Commit 순서다. Viewer/Commenter는 읽기만 가능하다. 저장 실패는 성공 표시를 하지 않고 기존 데이터와 입력을 보존한다.

Graph는 현재 Page를 중심으로 열고 한 화면에 최대 200개 Node를 보여준다. 연결 종류와 문서 제목은 허용된 데이터만 사용한다. 터치·키보드·텍스트 목록으로 탐색할 수 있게 하며 기존 중성색 Design Token과 Context Panel 구조를 유지한다.

## 구현과 검증 순서

1. 공유 검색/Tag/연결 Schema, 제한된 Query Parser·정규화·점수/연결 계산과 정상·경계 Tests.
2. 파생 Index Migration·Repository/Service·권한 검사·검색 API와 Commit/복구/삭제 회귀.
3. 로컬 Index와 캐시 범위, 검색 필터/연산자/속성 UI, Tag Properties, Graph·추천·링크 상태.
4. 두 기기 수정·Offline Reload·새 기기 검색·철회·Trash·Import/Snapshot을 브라우저에서 확인.
5. 1,000 Pages·1,000 Rows·500 Blocks 데이터로 Local Search 200ms 목표를 측정. lint·type-check·전체 Tests/E2E·build·Docker·백업 복원 후 Render → Vercel 배포와 실제 HTTPS 검증.

새 Editor 형식의 호환성과 이전 버전 복제/복구의 Metadata 손실을 확인하고 필요한 최소 Protocol을 올린다. Alpha 당시 Deferred 표시는 과거 출시 범위로 유지하며, 9개 항목은 배포 증거가 생긴 뒤에만 전체 완료 수에 포함한다.

## 2026-10-06 파서 기반 진행

공유 `search-query.ts`에 512자/32조건 제한, 따옴표·제외어·type/tag/workspace/before/after와 typed Property 연산자 AST, Unicode 정규화와 요청 Schema를 작성했다. 실행 코드를 만들지 않으며 지원하지 않은 구문·잘못된 날짜·비유한 숫자·추가 AST 필드를 거절한다. 집중 33 Tests와 lint·type-check가 통과했다. 아직 Index/API/UI에 연결하지 않았으며 기능 완료 수는 계속 44/148이다.

첫 전체 검증은 368개 통과 후 Realtime 서버 초기화 Hook이 기본 10초 제한을 넘어 8개가 실행되지 못했다. 반복된 로컬 병렬 초기화 지연에 맞춰 해당 Hook의 대기를 30초로 명시한 뒤 전체 376 Tests가 통과했다. Production 배포 소스 `f7b4c00`의 343 Tests/23 E2E/실제 HTTPS 검증은 별도 출시 기록에 유지한다.

`49f85c5`의 [CI 37421627184](https://github.com/GUnT0x9/ZeroNote/actions/runs/37421627184)도 통과했다. 아직 검색 API/UI와 새 데이터 형식이 없는 기반 모듈이며 Production은 검증한 `f7b4c00`을 유지한다.

| 파일                                       | 변경 이유                                         |
| ------------------------------------------ | ------------------------------------------------- |
| `packages/shared/src/search-query.ts`      | UI·서버가 사용할 제한된 검색 AST/정규화/구문 파서 |
| `packages/shared/src/search-query.test.ts` | 정상/오류 구문·날짜·형·길이·요청 AST 33개 회귀    |
| `apps/server/src/realtime.test.ts`         | 반복된 로컬 초기화 지연에 맞춘 Hook 대기          |
| `docs/knowledge-search-plan.md`            | 9개 기능의 저장·권한·Offline·UI·검증 계약         |

## 2026-10-06 Tag와 source Index 진행

Tag CRDT·Properties 편집·Snapshot 미리보기·복제/Import 보존을 구현했다. Migration 008은 Protocol 4와 source 검색 Index를 추가하며 Commit/Checkpoint transaction에서 Index를 함께 저장한다. 기존 데이터의 초기 Index는 Page lock과 Checkpoint+이후 Update로 생성한다. Relation 대상 이름과 Formula/Rollup 결과는 공통 Index에 보관하지 않는다. 검색 API/새 필터 UI/Graph/추천은 아직 연결하지 않았다. Tag의 CI·배포·실제 HTTPS는 [출시 기록](tags-release.md)에 확인 후 기록하며 그 전에는 전체 완료 수를 늘리지 않는다.

Verified 2026-10-06: Tag와 source Index를 `a09db74`로 배포했다. CI 394 Tests/24 E2E/Docker/512MiB/8개 Migration/16개 Table 암호화 복원과 실제 HTTPS 3개 흐름을 확인했다. [출시 기록](tags-release.md)에 따라 45/148 완료·103개 남음이다. 다음 단계는 검색 API와 로컬/서버 결과 병합, 필터/속성 조건 UI, Graph/추천/연결 상태다.
