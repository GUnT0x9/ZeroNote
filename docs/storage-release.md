# Storage 관리 구현 기록

전체 미완료 요구 중 Storage 관리(106번)를 구현한다. Settings → 저장 공간에서 서버 파일 한도/사용량/파일 목록과 이 기기의 사본/미전송·보존 수를 확인한다. 이 기기의 사본 제거는 서버에 저장된 파일만 대상으로 하고 접근 철회·Trash 파일을 보존한다. 제거한 사본은 연결 후 다시 내려받으며 문서는 유지한다.

서버 파일 정리는 Workspace Owner가 정확한 파일 이름을 확인해 수행한다. 현재 Page와 Trash, 보관 중인 Snapshot, Task Row 본문이 참조하는 파일은 거절한다. 문서 Commit/Snapshot/Upload와 같은 PostgreSQL Lock을 사용해 검사와 삭제 사이의 Race를 막는다. 파일 ID/Hash/Operation 기록은 남기고 bytes를 제거해 같은 Upload의 재시도가 파일을 복원하지 않게 한다. 파일을 새로 추가하면 Local 저장과 Block 삽입을 즉시 수행하되 Upload 완료 전에는 공동 편집 전송을 잠시 멈춘다. 참조 파일과 삽입 직전의 Upload를 확인하고 저장 후 연결을 재개하며 외부에서 저장된 파일의 Cache 부재는 연결을 막지 않는다. 이전 Offline Undo가 정리된 파일을 다시 참조하면 422로 저장을 거절하고 기기의 변경을 보존한다. 파일을 Export하거나 새 파일로 첨부할 수 있다.

Migration `005-attachment-purge.sql`은 기존 bytes를 보존하고 선택한 미참조 파일만 정리한다. Snapshot/문서/권한은 삭제하지 않는다. 기존 Editor Protocol 2를 유지하고 API를 추가한다. 이후 Server rollback은 Tombstone과 파일 참조 검증을 지원하는 버전을 사용한다. Web의 직전 버전은 API 추가와 호환된다. 서버 용량 집계는 남아 있는 논리 파일 크기이며 PostgreSQL의 물리 DB 크기는 DB 관리/Autovacuum 시점에 따라 즉시 줄지 않을 수 있다.

## 검증과 배포

로컬 Unit/Server Tests 198개가 통과했다. 미전송·보존·접근 철회·Trash 사본 유지, 서버 실패 시 로컬 bytes 유지, 정상/이름 오류/권한/다른 Workspace/참조/기록/Trash/재시도/Upload 충돌과 정리된 파일의 문서 Commit 거절을 포함한다. Migration 두 번 실행과 기존 Alpha Checkpoint 유지도 확인했다. 새 Storage 회귀는 자체 Fastify 인스턴스를 사용해 다른 인증 테스트의 Rate Limit 상태와 격리하며 Production 제한은 유지한다.

로컬 전체 브라우저 19개가 통과했다. 정상 Upload 중 WebSocket 422 거절이 없음을 확인하고 1,000 Pages/500 Blocks/1,000 Rows, 협업/Undo/Offline/Recovery/Export/Snapshot/권한의 기존 흐름도 유지했다. 최종 CI/Production 결과는 아래에 기록한다. 실제 Android/iOS 기기 검증과 전체 목표의 나머지 기능은 계속 미완료다.

## 변경 파일과 이유

| 파일                                           | 변경 이유                                       |
| ---------------------------------------------- | ----------------------------------------------- |
| Shared attachments Schema                      | 서버 파일 목록·확인 입력의 검증 계약            |
| attachment store/service/routes                | Owner의 참조 검사·정리·사용량·Tombstone         |
| DocumentStore                                  | 정리/누락/다른 Page 파일의 잘못된 Commit 거절   |
| Migration 005와 Migration Test/CI              | 데이터 유지와 재실행·백업 복원 검증             |
| documents/attachments/DocumentView와 연결 회귀 | 파일 저장 후 WebSocket 전송과 Race/Offline 검증 |
| Web storage helper/test                        | 로컬 bytes·권한 철회 사본 유지와 실패 검증      |
| StorageDialog/Settings/CSS                     | 서버·기기 용량과 정리 UI 연결                   |
| Service Worker                                 | 새 App Shell Cache와 메인 경로만 Cache          |
| Server storage/browser tests                   | 정상·권한·참조·Offline·재시도 회귀              |
| API/Decision/완료 기록                         | 동작 계약·호환성·배포 증거                      |

## 2026-10-06 Production 결과

- Source Commit `32d6e135a76f1e5393b640b700452b4c89b1707b`, CI `36979587809` 성공: lint, type-check, 198 Unit/Server Tests, 19 E2E, Web/Server build, 512MiB 서버 Docker 실행, 암호화 백업·복원과 Migration 5개를 검증했다.
- 배포 직전 암호화 백업을 완료했고 최근 4개를 유지한다. Render `dep-davm2p1srm7s73chh0hg`가 Live이며 Production DB의 Migration 005 적용을 확인했다.
- Vercel `dpl_ARtxaefhAnu9Jnec9RgyVeoXHDMv`가 같은 Commit으로 Ready다. Production Alias `zeronote-kohl.vercel.app`의 실제 Deployment ID도 일치한다. CLI 인증 갱신 후 명시한 Team scope로 재시도가 성공했다.
- 실제 HTTPS 브라우저 회귀 3개 성공: 암호화 Export/새 Workspace Import, 파일·Offline·Viewer·Snapshot, Storage 참조 거절·미참조 파일 정리·미전송 사본 유지. 테스트 Workspace는 정확한 ID와 이름 확인 후 제거했다.
- 실제 HTTPS의 4MiB 파일 Upload → 새 기기 Recovery → SHA256 일치 Download → Offline PDF 새로고침도 성공했다.

Production: https://zeronote-kohl.vercel.app · API: https://zeronote-api.onrender.com
