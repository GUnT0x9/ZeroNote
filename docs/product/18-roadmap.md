# Dependency Roadmap

Status: Accepted Alpha specification

2026-10-02 사용자 확정: 체크리스트의 모든 미완료 기능을 구현·배포한다. 기존 P0–P3는 실행 순서이며 범위 제한이 아니다. 148개 항목의 완료 증거와 남은 작업은 [전체 목표](../full-completion.md)에서 추적한다. 파일 기반/Template/Command/Mobile 편집 다음에는 Export/Public Share와 나머지 Editor·Knowledge·Database·협업·암호화·AI·Integration·Canvas·플랫폼 기능을 이어간다.

Foundation → Page/Block/Local Persistence → 서버 Metadata/Identity → Recovery/Capability → Realtime/Durable Sync → Task/Comments/Search/Mobile → Failure Recovery/Export/검증.

1주차: Editor와 Local Workspace. 완료: Offline 작성과 Reload 유지. 2주차: 두 기기 공동 편집·초대·Recovery. 완료: Role과 영속 저장 검증. 3주차: Task View·Comments·Quick Capture·Mobile. 완료: 대표 흐름 연결. 4주차: 장애·성능·데이터 이전·회귀. 완료: lint/type/test/e2e/build와 Alpha 기준 검증.

후속: Database Property 모델 → Calendar/Timeline/Gallery → Relation/Rollup/Formula. Snapshot/Restore → Compare → Branch/Review/Merge. Share 권한 → Public/Temporary/Burn. 파일 저장 → Media/Canvas/Developer Blocks. 안정된 API → Automation/Webhook/Integration. Web 안정화 → Desktop/Global Capture/Pairing.

각 후속 단계는 구현 전 요구사항·권한·Offline·완료 기준을 추가한다. Alpha에 없는 기능을 완성했다고 표시하지 않는다. 목표 기간은 보장된 완료 날짜가 아니며 검증 결과로 출시한다.

## 초대 Beta

배포 연결(Vercel/Render/Neon Free) → 버전별 Migration·Commit/Checkpoint/압축 → Beta 코드·Quota → Snapshot/새 Page 복구 → HTTPS/Mobile/백업 검증 → 운영자 2명 → 5–10명 확대.

예상 1–2주이며 실제 공개는 CI·배포·Mobile·Production 복원 검증으로 결정한다. Snapshot 복구는 원본을 유지하는 새 비공유 Page다. 계정 설정·배포 주소·운영 체크는 `docs/beta-launch.md`를 따른다. 일반 Database 확장과 Branch/Merge는 이후 단계다.

## P0 Database 확장

2026-10-02: 일반 Property 13종과 Saved View, Filter/Sort/Group, Calendar/Timeline/Gallery/List을 추가한다. 이전 메인 UI 개편과 함께 CI 통과 후 Render → Vercel Production에 배포한다. 파일 저장과 Public Share/전체 모바일 편집은 다음 P1, Relation/Rollup/Formula는 P2로 유지한다. 전체 기능 체크리스트는 `docs/feature-checklist.md`에서 실제 구현 증거와 후속 항목을 구분한다.

2026-10-02 데이터 이전의 8개 기능을 구현했다. [형식과 검증](../transfer-release.md)에 범위를 기록하며 전체 148개 중 남은 116개는 계속 개발한다.

2026-10-06 Storage와 Public Sharing 7개 기능의 CI·실제 HTTPS 검증/배포까지 반영해 전체 완료 수는 40개, 남은 요구는 108개다. 다음 File Property/Relation/Rollup/Formula는 [Database 확장 기준](../database-advanced-plan.md)을 따른다. Formula 파서 기반을 작성 중이며 UI·저장·공개 범위·배포 증거를 갖추기 전에는 완료로 표시하지 않는다.

2026-10-06 Database 속성 4개를 CI 343 Tests/23 E2E/Docker/백업 복원과 실제 HTTPS 협업·권한 철회·Offline·Snapshot·Recovery로 확인하고 배포했다. [출시 기록](../database-advanced-release.md)에 따라 완료 수는 44개, 남은 요구는 104개다. 다음 묶음은 [Knowledge·Search·Tags의 9개 기능](../knowledge-search-plan.md)이며 기반 코드만으로 완료를 표시하지 않는다.

2026-10-06 Page Tags와 source 검색 Index 배포 완료: 45/148 항목 검증 완료·103개 계속 구현. 다음은 Global/Fuzzy Search·연산자·필터/속성 조건·Graph·추천·Broken Link 8개다. 검색 Index의 존재만으로 검색 기능 완료로 집계하지 않는다. [출시 기록](../tags-release.md).

2026-10-07 검색 5개 배포 완료: 50/148 항목 검증 완료·98개 계속 구현. 다음은 Knowledge Graph·Related Pages·Broken Link와 전체 Backlinks의 서버 Index 연결이다. [출시 기록](../search-release.md).

2026-10-07 Knowledge 3개와 전체 Backlinks의 서버 Index 연결을 배포했다. 53/148 항목 검증 완료·95개 계속 구현. [출시 기록](../knowledge-release.md). 다음은 [Subtask·Dependency·Label·Estimate·Template 구현](../task-extension-plan.md)이며 후속 Task/Comments/Member/Notification과 전체 미완료 요구도 계속 진행한다.
