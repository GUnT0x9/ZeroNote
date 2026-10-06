# Public Sharing 구현 기본안

전체 미완료 요구 85–91번(Public Page/Password/Temporary/Burn/Expiring Link/Public Workspace/SEO)을 다음 묶음으로 구현한다. 아래는 구현 기준이며 아직 기능 완료 증거가 아니다.

## 권한과 게시 데이터

Workspace Owner가 선택한 Page 또는 명시적으로 고른 Workspace Page 목록을 게시한다. 새 하위 Page와 비공개 Page는 자동으로 추가하지 않는다. 현재 내용의 읽기 전용 문서/Database/Row 본문과 참조 파일을 제공한다. Comments/초대/기기/Identity/Recovery/원본 CRDT Update와 삭제된 과거 텍스트를 노출하지 않는다. 링크는 게시 범위 안에서만 연결하고 비공개 Page의 ID·제목·경로를 내보내지 않는다.

Public Viewer는 Device Identity/개인 Workspace를 생성하지 않고 읽기 화면에서 시작한다. 편집·WebSocket·개인 앱의 IndexedDB 저장을 연결하지 않는다. 현재 Portable AST/안전한 HTML 변환을 재사용하고 attrs/URL/Mark를 명시적인 Allowlist로 제한한다. 파일은 게시 범위와 현재 참조, 삭제·정리 상태를 서버가 매 요청 검사한다.

## 공유 모드

- Public: 난수 경로의 링크로 읽으며 Owner가 해제할 수 있다. 문서 변경을 반영한다.
- Password: 링크와 암호를 모두 확인한다. 서버에는 Salt/Hash만 보관하고 암호 검증 시 요청 횟수를 제한한다.
- Temporary/Expiring: Owner가 UTC 만료 시각을 정한다. 기본 Temporary는 1시간이며 Server 시간을 기준으로 만료와 철회를 검사한다.
- Burn: 사용자가 명시적으로 열기를 눌렀을 때 한 읽기 Session만 Transaction으로 승인한다. 미리보기·검색 Bot·Metadata GET으로 소모하지 않는다. 재시도 Operation ID로 중복 소모를 막고 해당 Session에서 최초 내용을 일정 시간 읽고 파일을 받을 수 있다. 다른 Session은 거절한다. 전달된 사본의 삭제를 보장하는 표현은 사용하지 않는다.
- Public Workspace: Owner가 선택한 Page 목록만 Navigation에 표시한다. Private 부모/새 Page/외부 Mention은 게시하지 않는다.
- SEO: 보호되지 않은 Public 공유에만 Owner가 명시적으로 켠다. 기본 noindex이며 Password/Temporary/Burn은 SEO를 허용하지 않는다. 제목/설명/Canonical/Open Graph/robots는 공개된 내용에서만 만든다.

보호된 링크의 난수 Secret은 URL Fragment로 전달하고 서버에 Hash만 보관한다. 암호·Secret은 URL Query, Log, Analytics, 개인 기기 저장에 넣지 않는다. 읽기 Session은 Secure/HttpOnly/SameSite Cookie와 서버 만료·철회 검사로 관리한다.

## 구현 순서와 검증

공유 Zod 계약 → Additive Migration/Store/Service/REST → Owner Share/Settings UI → 별도 Next Public 경로/읽기 화면/SEO → 회귀/Build/CI → 백업/Render/Vercel/HTTPS 순서로 진행한다. Private 앱의 Service Worker는 메인 App Shell과 정적 Asset만 Cache하며 Public 페이지·API·보호 내용은 Cache하지 않는다.

정상 게시, 해제, Trash/Workspace 삭제, Viewer/Editor 권한 차단, Password/만료/동시 Burn·재시도·파일 Scope, Private Mention/과거 삭제 텍스트 비노출, Public Workspace 선택 범위, SEO 기본값, HTML/Script URL, 실제 HTTPS/Cookie와 기존 198 Tests/19 E2E를 검증한다. 새 Block/Property를 추가할 때 Public/Export Serializer도 함께 확장한다. 선택형 E2EE 구현 시 공개 자료는 별도 명시적 게시 경계를 적용한다.
