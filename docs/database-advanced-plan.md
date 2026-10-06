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
