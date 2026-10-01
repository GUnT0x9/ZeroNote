# 성능 요구사항

Status: Accepted Alpha specification

Alpha 검증 규모: Workspace 1,000 Pages, Task Database 1,000 Rows, 문서 500 Blocks, Page 동시 접속 5명. Desktop 캐시 문서 열기 목표 1초, Local Search 목표 200ms.

측정은 테스트 데이터·Browser·서버 환경과 함께 기록한다. 실제로 측정하지 않은 수치를 통과했다고 보고하지 않는다. Metadata는 접근 가능한 범위만 가져오고 검색은 로컬 Projection에서 처리한다.

편집과 Network Commit을 분리하고 로컬 저장/Index Projection은 묶어서 처리한다. Realtime 문서는 열려 있는 Resource 중심으로 연결한다. Task Table은 큰 Dataset에서 Virtualization 또는 Pagination을 사용한다.

Update Message와 문서 Snapshot의 크기를 제한한다. 저장 공간 사용량을 Storage API로 확인하고 QuotaExceededError를 명시적으로 처리한다. 대규모 첨부·Semantic Search·서버 Search는 Alpha에 포함하지 않는다.
