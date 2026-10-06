# Database 확장 구현 기준

전체 미완료 요구 38–41번(File Property, Formula, Relation, Rollup)을 이어서 구현한다. 이 문서는 구현 기준이며 아직 완료 증거가 아니다. Public Sharing의 배포·HTTPS 검증을 마친 뒤 해당 Migration을 적용한다.

## 저장과 계산

- 기존 Property ID와 Row별 `property:<id>` Y.Map 값을 유지한다. 새 Property 정의는 공유 Zod Schema로 검증한다.
- File은 해당 Database Page에 업로드한 파일 ID 목록을 저장한다. 기존 Offline 파일 Queue, 용량·파일 권한·삭제·정리·Snapshot 보존을 그대로 적용한다. Row의 파일 값도 살아 있는 첨부 참조 검사와 ID 재매핑에 포함한다.
- Relation은 같은 Workspace에서 접근 가능한 Database와 활성 Row를 선택한다. 안정적인 Database/Row ID를 사용하고 제목 변경 시 연결을 유지한다. 삭제·Trash·권한 철회된 대상은 선택·이름·본문·계산 결과를 노출하지 않는다.
- Formula는 속성 참조, 산술·비교·논리 연산과 명시적인 함수 목록을 제공한다. 코드를 실행하는 `eval`/`Function`을 사용하지 않는다. 수식을 파싱할 때 속성 이름을 ID로 연결해 이름 변경을 지원한다. 오류·0으로 나누기·잘못된 형·순환 의존·길이와 계산량 제한을 구분한다. 계산 결과를 별도의 편집 원본으로 저장하지 않는다.
- Rollup은 Relation의 활성 Row와 선택한 속성을 읽어 합계·평균·최소·최대·개수·고유 값 등 지원하는 집계를 계산한다. 대상의 접근 불가·미저장·삭제와 빈 관계를 구분한다. 접근하지 못한 대상의 이전 결과를 새 계산 결과처럼 표시하지 않는다.
- Formula/Rollup은 읽기 전용 값이며 Table·Board·상세·검색/필터/정렬에 동일한 계산 함수를 사용한다. 순환 의존과 무제한 대상 로딩을 차단한다.

## Offline·협업·호환성

이미 저장한 대상 문서는 Offline에서 계산한다. 이 기기에 없는 대상은 Online에서 한 번 열도록 안내하며 임의의 0이나 빈 Row로 대체하지 않는다. 대상 문서 변경과 접근 상태 변경을 구독해 열린 화면을 갱신한다. Relation은 접근 권한을 추가하거나 전파하지 않는다.

새 Property 형식을 모르는 구버전 Editor가 내용을 손실시키지 않도록 문서별 최소 Editor Protocol을 확장한다. Migration은 기존 문서·Update·Checkpoint를 보존하고 직전 Web의 기존 문서는 계속 처리한다. 배포는 CI → 암호화 백업 → Render → Vercel 순서다.

## 이동과 공개 데이터

Snapshot/복제/Workspace Export·Import에서 정의·수식·Row 값·파일을 보존한다. Workspace Import는 포함된 Database ID를 새 ID로 재매핑한다. 범위 밖 관계에 새 권한을 생성하지 않는다.

Public Sharing은 게시 범위 안의 Database/Row와 파일만 읽는다. 공개 범위 밖 Relation의 ID·제목과 그 대상에서 파생한 Rollup/Formula 결과를 노출하지 않는다. Person과 그 파생 값도 공개하지 않는다. Portable Export의 Markdown·HTML·CSV·PDF 표에도 지원하는 결과를 반영한다.

## 검증

각 기능의 정상 흐름과 실패 흐름을 Unit/Server 및 실제 브라우저에서 검증한다. 중점은 파일 참조·정리 보호, 속성/Row 이름 변경, 서로 다른 필드의 동시 변경, Offline Reload, Viewer 쓰기 차단, 관계 대상 권한 철회, 수식 순환·형 오류·계산량 제한, 집계 일치, Export/Import·Snapshot·공개 범위 회귀다.

배포 전 lint·type-check·test·build·E2E·Docker·백업 복원을 확인하고 실제 HTTPS 증거를 출시 기록과 전체 체크리스트에 남긴다.

## 2026-10-06 기반 모듈 진행

`packages/shared/src/formula.ts`에 속성 ID 참조 AST, 제한된 문법 파서, 저장된 AST 형식 검증과 계산 함수를 추가했다. 산술·비교·논리·조건/문자열/숫자 함수, 짧은 조건 평가, 0 나누기·형/참조 오류와 입력/노드/중첩/결과 크기 제한을 검증했다. 허용하지 않은 함수·추가 필드·순환 AST는 속성을 읽기 전에 거절한다.

집중 65 Tests, lint·type-check 및 전체 277 Tests가 통과했다. 최초 병렬 검증에서 Realtime `beforeAll`의 10초 초기화 제한을 넘겼으며 해당 6개를 단독 확인한 뒤 `pnpm test --maxWorkers=4`로 전체를 다시 통과했다. Production 코드는 변경하지 않았다.

이후 공유 Property Schema/의존 계산기와 File/Relation/Formula/Rollup UI를 연결했다. 접근 가능한 대상 문서 구독과 가벼운 파일 Metadata Cache, Owner 보존 파일 조회, Markdown/HTML/CSV/PDF 계산 결과, 게시 Scope에 제한된 Public Projection, 파일·관계 ID 재매핑과 Snapshot 참조 보호를 추가했다. Protocol 3과 Migration 007을 추가하되 기존 Attachment 문서의 Protocol 2 접근을 유지한다.

2026-10-06 집중 139 Tests, 데이터 이전·공개 Projection 16 Tests, HTTP/계산 28 Tests를 통과했다(서로 중복되어 합계로 사용하지 않는다). 최초 전체 326개 중 325개 통과 후 HTTP 테스트의 고정 Protocol 기대값을 현재 상수로 수정했다. 추가 서버 시험의 인증 실패는 독립된 시나리오가 같은 IP의 등록 제한을 소모한 것이며 시나리오별 주소를 분리해 27개를 재통과했다. 같은 IP의 실제 요청 제한도 별도로 검사한다. Production 제한은 변경하지 않았다.

전체 329 Tests를 통과했다. 브라우저 검증에서 공유받은 Viewer Page의 파일명 로딩이 멈추는 오류를 확인했다. 서버에 등록된 Page도 Metadata revision 0부터 시작하므로 revision으로 미등록 여부를 판단하던 코드를 생성 Queue 기준으로 수정했다. Viewer의 revision 0 조회와 생성 대기/승인 후 조회를 확인하는 회귀를 포함해 파일 Metadata·접근 범위 10 Tests를 통과했다. 수정 후 실제 브라우저에서 File/Formula/Relation/Rollup 생성, 속성/Row 이름 변경, Offline Reload, Viewer 파일 Preview/권한 차단 및 Snapshot 새 Page 복구 흐름을 통과했다. 추가로 Snapshot 파일명이 현재 파일 조회에 의해 지워지는 Cache 경쟁을 막고, Realtime/Token 실패 시 서버가 확인한 권한 철회·삭제를 로컬 Page에 반영하도록 수정했다. 이 변경의 정상·실패/일시 장애 경로 16 Tests를 통과했다. 최종 lint·type-check·전체 335 Tests가 통과했고, 실제 브라우저에서 추가 공유 수락 → 계산 값 표시 → 권한 철회 → 관계 이름/계산 숨김 → Owner Snapshot 새 Page 복구를 포함한 전체 시나리오도 통과했다(29.6초). 중간 브라우저 실패는 항목 열기 버튼의 접근성 이름과 재로딩 후 이미 닫힌 패널을 닫으려던 테스트 경로를 수정해 해결했다.

Web Production build와 집중 브라우저 검증을 통과했으며, CI 전체 브라우저/Server build/Docker·백업 복원·HTTPS 검증과 기능 배포가 남아 이 4개를 완료로 체크하지 않는다. 현재 Production은 Public Sharing 소스 `0b25956`이며 전체 완료 수는 계속 40/148이다.
