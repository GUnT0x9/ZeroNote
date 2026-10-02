# 파일·Editor 확장 기록

2026-10-02. `codex/remaining-features`에서 전체 미완료 기능 중 파일 기반, 문서 Template/복제, Command Palette, 수동 Sync, Mobile 편집을 연결했다. 전체 목표는 [항목별 기록](full-completion.md)에 남아 있으며 이번 묶음으로 종료하지 않는다.

## 저장과 편집

파일은 먼저 Dexie에 bytes/Hash/Operation ID를 저장하고 Block을 삽입한다. Metadata 등록 → 파일 Commit → 문서 Commit 순으로 전송한다. PostgreSQL Bytea에 영속 저장하고 4MiB/파일, 25MiB·200개/Workspace, 기존 서버 용량 한도를 함께 검사한다. 실패/권한 철회는 이 기기의 사본을 남긴다. Share와 파일 권한은 Page를 따른다. SVG/HTML을 실행하지 않으며 원본 다운로드는 `nosniff`·sandbox·attachment 헤더를 적용한다.

이미지, Audio/Video controls, 소스 텍스트, PDF 페이지 Canvas/Text Preview를 제공한다. PDF Worker/Font/WASM/ICC는 버전별 정적 파일로 앱에 포함하고 방문한 파일은 SW가 Cache한다. 큰 Canvas를 제한하고 손상 PDF는 다운로드를 유지하며 오류를 표시한다. 파일 선택·Paste·Drop·Mobile 편집을 지원한다.

Snapshot 복구와 Page 복제는 원본 파일을 새 ID로 복사한다. 자기 Page 링크만 재매핑하며 외부 링크는 유지한다. Heading/Todo 등 JSON 속성도 보존한다. 복구 Metadata Sync 후 새 Page를 열어 이전 목록 응답에 의한 접근 상실을 막는다. Export version 2에는 참조 파일이 포함되며 version 1도 Import한다.

## Template과 Command

회의록/기술문서/주간계획과 Owner가 저장한 문서 Template을 제공한다. 새 문서에만 기본 Template을 적용하고 복제된 문서는 독립 CRDT로 편집한다. Share/Comments/하위 Page/Favorites를 복사하지 않는다.

Ctrl/Cmd K의 `>`에서 문서/Database/To-Do 생성, 이동, Theme, Capture/Inbox/Settings/Sync를 실행한다. 최근 8개 명령과 Theme을 이 기기에 보관한다. `>open`, `>go`, `>이동`은 접근 가능한 Page 결과로 이어진다. 기존 일반 검색을 유지한다.

## 버전 호환

Migration `003-attachments.sql`과 `004-editor-protocol.sql`은 기존 데이터를 유지한다. 새 클라이언트는 `X-ZeroNote-Editor-Protocol: 2`를 전송하고 문서 Token에도 버전을 포함한다. Header/Token이 없는 앱은 1이다. 기존 Block만 있는 문서는 계속 제공한다.

구버전 ProseMirror/Yjs 어댑터는 Schema에 없는 Block을 렌더링할 때 CRDT에서 삭제하므로 새 Block 문서는 426으로 새로고침을 요구한다. 서버 Checkpoint에 최소 버전을 유지해 Block 제거/재시작 후에도 구버전 Offline 삭제를 거절한다. REST/WebSocket 모두 Commit 전 검사하며 활성 구버전 연결을 새 Block 방송 전에 종료한다. Snapshot 미리보기에도 검사한다. 권한 검사는 버전과 독립적으로 유지한다.

## 검증 / 배포

이후 Rollback은 Editor Protocol 2를 이해하는 Web/Server 버전을 사용한다. 새 Block을 저장한 기기에 Protocol 1 Editor를 재배포하면 로컬 CRDT가 손상될 수 있으므로 이전 P0 Web/Server로 되돌리지 않는다. DB Migration은 유지하고 호환 수정 Commit으로 재배포한다.

로컬·CI·Production 결과를 검증 후 여기에 기록한다. 배포 순서는 CI 통과 Commit의 Render → Vercel이며 Migration을 되감지 않는다.

- 첫 전체 브라우저 검증 15개 통과: Media Decode/PDF 오류, 파일·Offline·Viewer·Snapshot, Template·Command, 기존 Editor/Task/권한/Recovery/일반 Database와 1,000 Pages/500 Blocks/1,000 Rows.
- 호환성 추가 후 Unit/Server 162개 통과. 새 Block을 보내기 전 구버전 연결 종료, 구버전 Offline 삭제/조회/Token/Snapshot 거절, 현재 기기 유지, Atomic 저장/Quota/Retry 검증 포함.
- 최종 로컬 lint/type-check/Server build 통과. Protocol 추가 후 전체 E2E 15개도 통과했다. 최종 Unit/Server 162개에 배포 전에 발급된 구버전 Token 거절도 포함한다.
- 로컬 Docker는 WSL Docker Desktop CLI 경로가 끊겨 실행하지 못했다. CI에서 Docker Build/512MiB 시작과 파일 bytes를 포함한 암호화 백업·복원을 검증한다. Production 배포 결과는 아래에 확정 기록한다.
- 실제 Android Chrome/iOS Safari 기기 검증은 아직 미실행이다. Chromium Touch Viewport로 Mobile 편집/Capture/Comments를 검증한다.
- Storage 관리 UI/영구 정리, Table/Column/Math/Embed, Public Share/Export 추가 형식 등 나머지 항목은 계속 구현한다.

최종 호환성 검증에서 기본 `hardBreak`와 Yjs의 Hash가 붙은 기존 Link Mark도 Protocol 1로 인식하도록 보강했다. 이전 CI의 Offline 상태 회귀도 확인해, 연결이 끊긴 후 늦은 정상 응답이 상태를 Online으로 바꾸지 않게 수정했다. Unit/Server 총 163개, 최종 lint/type-check와 앱 Build가 통과했다.

`36f2411`의 CI `36958355714`에서 163 Tests/15 E2E/Build/Docker 512MiB/첨부 bytes 백업 복원을 통과하고 Render `dep-davhvqegekts73e4pt4g` → Vercel `dpl_Bi9b5jt6Zf3b31sB6kCjimvbNcdT` 순서로 배포했다. 실제 HTTPS 14개 Browser 시나리오와 기존 Recovery/문서/Task/Comments/Snapshot/Viewer 권한 유지도 통과했다. 수동 최대 파일 검증에서 4MiB Base64 반복 Group의 RegExp Stack Overflow를 발견했고, Padding/Pad Bits/Decoded Size를 검사하는 검증으로 수정한다. 최대 파일 저장·다운로드·재시도와 초과 크기 거절 회귀를 추가해 재배포 후 최대 크기 HTTPS 검증을 마무리한다.
