# Dependency Roadmap

Status: Accepted Alpha specification

Foundation → Page/Block/Local Persistence → 서버 Metadata/Identity → Recovery/Capability → Realtime/Durable Sync → Task/Comments/Search/Mobile → Failure Recovery/Export/검증.

1주차: Editor와 Local Workspace. 완료: Offline 작성과 Reload 유지. 2주차: 두 기기 공동 편집·초대·Recovery. 완료: Role과 영속 저장 검증. 3주차: Task View·Comments·Quick Capture·Mobile. 완료: 대표 흐름 연결. 4주차: 장애·성능·데이터 이전·회귀. 완료: lint/type/test/e2e/build와 Alpha 기준 검증.

후속: Database Property 모델 → Calendar/Timeline/Gallery → Relation/Rollup/Formula. Snapshot/Restore → Compare → Branch/Review/Merge. Share 권한 → Public/Temporary/Burn. 파일 저장 → Media/Canvas/Developer Blocks. 안정된 API → Automation/Webhook/Integration. Web 안정화 → Desktop/Global Capture/Pairing.

각 후속 단계는 구현 전 요구사항·권한·Offline·완료 기준을 추가한다. Alpha에 없는 기능을 완성했다고 표시하지 않는다. 목표 기간은 보장된 완료 날짜가 아니며 검증 결과로 출시한다.

## 초대 Beta

배포 연결(Vercel/Render/Neon Free) → 버전별 Migration·Commit/Checkpoint/압축 → Beta 코드·Quota → Snapshot/새 Page 복구 → HTTPS/Mobile/백업 검증 → 운영자 2명 → 5–10명 확대.

예상 1–2주이며 실제 공개는 CI·배포·Mobile·Production 복원 검증으로 결정한다. Snapshot 복구는 원본을 유지하는 새 비공유 Page다. 계정 설정·배포 주소·운영 체크는 `docs/beta-launch.md`를 따른다. 일반 Database 확장과 Branch/Merge는 이후 단계다.

## P0 Database 확장

2026-10-02: 일반 Property 13종과 Saved View, Filter/Sort/Group, Calendar/Timeline/Gallery/List을 추가한다. 이전 메인 UI 개편과 함께 CI 통과 후 Render → Vercel Production에 배포한다. 파일 저장과 Public Share/전체 모바일 편집은 다음 P1, Relation/Rollup/Formula는 P2로 유지한다. 전체 기능 체크리스트는 `docs/feature-checklist.md`에서 실제 구현 증거와 후속 항목을 구분한다.
