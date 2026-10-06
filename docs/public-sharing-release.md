# Public Sharing 구현·검증 기록

2026-10-06 전체 미구현 항목 85–91번 Public Page, Password, Temporary, Burn, Expiring Link, Public Workspace, SEO를 구현·배포하고 CI와 실제 HTTPS에서 검증했다. 전체 148개 중 완료 수는 40개이며 108개는 계속 개발한다.

Owner는 기존 Share의 ‘웹에 게시’ 또는 Settings → Workspace 공개 공유에서 Page를 고르고 링크를 발급한다. 개인 Page 초대 UI는 유지한다. 일반 공유만 검색 엔진 등록을 명시적으로 켤 수 있다. 보호된 공유는 URL Fragment Secret과 서버 읽기 Session을 사용하며 링크 원문은 발급 시에만 복사한다. 해제 전 확인과 상태 목록을 제공한다.

별도 `/s/:shareId[/:publicPageKey]` 화면은 계정·Device·개인 IndexedDB·편집기·WebSocket을 생성하지 않는다. SSR과 읽기 전용 Page/Database/Row 본문/파일을 제공한다. 선택 범위 밖의 Parent/새 Page/비공개 링크를 공개하지 않는다. Person Property와 권한 정보도 제공하지 않는다. 현재 살아 있는 Yjs 내용에서 Allowlist Projection을 만들며 삭제된 과거 CRDT는 전달하지 않는다. 보존 HTML의 크기 제한은 Page당 5MiB, Burn 전체 5MiB다.

Burn은 명시적인 열기 POST의 첫 Session만 승인한다. 첫 내용을 고정해 이후 작성 내용을 내보내지 않으며 같은 Session에서 새로고침과 파일 읽기가 가능하다. 이미 전달된 사본을 회수하는 기능으로 설명하지 않는다. 해제·만료·Parent Trash·파일 삭제는 이후 요청을 제한한다. 자동 작업이나 서버 유휴 중 Polling은 만들지 않는다. Owner의 관리 요청에서 만료된 읽기 내용을 정리하며, 게시 해제 Transaction에서 해당 Session과 고정한 본문을 제거한다. 만료 시각은 ISO UTC로 통일하고 공개 ID는 검증·소문자 정규화해 Cookie Scope를 유지한다. 공개된 Database의 활성 Row만 Task 링크로 연결한다.

Migration 006은 기존 내용을 변경하지 않고 공개 링크·Page Scope·읽기 Session 테이블을 추가한다. Editor Protocol 2를 유지한다. Public API와 페이지는 Cache하지 않고 기존 Service Worker의 메인 App Shell Cache만 사용한다. 앱 버전 Rollback 시 DB를 자동 되감지 않는다.

## 검증 결과

- 집중 Unit/Server 및 읽기 Helper 검증과 전체 Unit/Server 212개 통과: Projection/삭제된 과거 내용/Script URL/비공개 Link, Password Salt와 거절, Database/Row/Person 제외, Owner/Origin/Scope, 초대 역할 차단, 링크 재시도/충돌, 만료/Trash/해제, 동시 Burn/Session 재시도/최초 내용/파일 보존, Metadata/SEO 계약, Migration/Storage 기존 회귀.
- lint·type-check·Web/Server Build 및 전체 로컬 E2E 22개 통과. Public Page/Password/Temporary/Burn/Public Workspace 3개 흐름과 기존 Service Worker를 사용하는 Public Offline 새로고침·no-cache를 포함한다. 초기 실패는 Next.js의 숨겨진 Alert 선택 충돌과 Task 상세를 열지 않은 테스트 절차를 수정했다. Operator CLI의 로컬 초기 로딩 대기는 60초로 늘리고 일반 API의 15초 제한은 유지한다. 체크리스트의 나머지 기능과 실제 Android/iOS 확인은 계속 미완료다.
- 배포 전 Production DB 암호화 백업 성공, 최근 4개 보관. Migration 006과 신규 공개 공유 테이블의 별도 DB 복원도 CI에서 통과했다.

## CI·Production 배포 증거

- 앱 소스: `0b25956c6223ec357160e81d7ff4003aeccacf22` (`codex/remaining-features`). [CI 37396219822](https://github.com/GUnT0x9/ZeroNote/actions/runs/37396219822) 성공: 212 Tests/22 E2E/lint/type-check/build, Server Docker Build, 512MiB 시작/Health, Migration 6개와 공개 공유 테이블을 포함한 암호화 백업/별도 DB 복원/Fingerprint 비교.
- Render `dep-db24f297lnhs73dil1b0` Live → Vercel `dpl_C3dsc4kk4tMRWAxDVVsSVygQ4ojf` READY 순서로 수동 배포. Vercel Production Alias가 동일 Deployment ID를 가리키고 Source SHA가 일치하는 것을 API로 확인했다. 실제 Production DB의 Migration 6개와 신규 테이블 3개를 확인했다. 검증 중이던 후속 Formula 모듈을 포함하지 않은 Commit Archive를 업로드했다.
- [Production Web](https://zeronote-kohl.vercel.app)에서 Browser 6개 통과: Media/PDF, 파일 Upload·Offline·Viewer·Snapshot, Storage 정리·미전송 파일 보존, Public Page·이미지·SEO·해제·no-cache, Password/Temporary/Burn·Secure HttpOnly Strict Cookie·새로고침 복원·두 번째 Reader 거절, 선택한 Public Workspace Page/Database/Row 본문과 읽기 전용 접근.
- 실제 브라우저에서 4MiB Upload 후 Private/Public 다운로드의 SHA-256과 원본 bytes 일치, 익명 공개 Range 206/Content-Range/정확한 부분 bytes, 새 기기 Recovery, Offline PDF 새로고침을 추가 확인했다. 검증용 Workspace는 정확한 ID와 이름으로 삭제했다.
- 실제 Android Chrome/iOS Safari, 나머지 108개 요구, Formula UI/Relation/Rollup/File Property는 이번 배포의 완료 범위에 포함하지 않는다.

## 변경 파일과 이유

| 파일                                          | 변경 이유                                               |
| --------------------------------------------- | ------------------------------------------------------- |
| Shared public-sharing Schema                  | 선택 범위·보호·Session·Projection 요청/응답 검증        |
| Migration 006 / Repository / PublicShareStore | 영속 링크·불투명 Page Key·멱등 발급·첫 Session 승인     |
| PublicShareService/Routes                     | Owner·Origin·읽기 Cookie와 익명 API 연결                |
| public-projection/password                    | 현재 내용 Allowlist와 안전한 HTML·Person 제외·Salt/Hash |
| attachment store/routes                       | 승인된 Burn의 파일 보존과 동일 Range/Download 응답      |
| public-share-manager / Context / Settings     | Page·Workspace 게시와 해제·기존 초대 유지               |
| PublicReader / Public Next Route / Metadata   | 익명 읽기·게이트·SSR·SEO opt-in·no-store                |
| Public Unit/Server/Browser Tests              | 성공·권한·보호·Race·과거 내용 비노출·실제 브라우저 회귀 |
| Migration Test / CI / API / 출시 기록         | 기존 데이터 유지·백업 복원·운영 계약과 검증 증거        |
