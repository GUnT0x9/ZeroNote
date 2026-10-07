# Workspace Member·Group 출시 검증

2026-10-07. 구현·로컬 검증 중이며 운영 반영 전 완료 수는 60/148을 유지한다. 전체 미완료 목표의 42·43을 대상으로 한다.

## 변경 이유와 동작

Settings에서 Owner가 Workspace Identity별 기기·개별 Page 권한을 확인하고 Role 변경·철회·Member 제거를 수행한다. 그룹의 구성원과 Page/Role/하위 Page 범위를 관리한다. 활성 그룹과 개별 공유 중 가장 높은 Role이 적용되며 구성 변경을 바로 반영한다. 자신을 제거하는 Owner 권한 회수는 허용하지 않는다. Owner Recovery 기기는 같은 Identity로 묶고 기기 Pairing은 별도 미완료 기능이다.

Member 제거 후에도 문서·댓글 작성자를 보존한다. 새 초대는 새로운 참여로 처리한다. 표시 이름은 현재 활성 Membership으로 확인한 본인 Identity에만 저장한다. Member 관리/그룹 생성만으로 Workspace 전체 접근을 부여하지 않는다.

## Offline·실패

권한은 Online 승인으로 변경하며 기기에는 마지막 확인 목록과 그룹 초안을 보관한다. 전송 전 Operation을 저장하고 입력을 같은 ID로 재시도한다. 결과를 모르는 전송·서버 거절·Commit 확인 이후 목록 조회 실패를 구분한다. 조회만 실패하면 쓰기를 반복하지 않는다. Revision 충돌은 기존 입력을 보관한 채 현재 상태를 검토하고 다시 적용한다. 자동 권한 Queue나 유휴 Polling을 추가하지 않는다.

Commit 이후 활성 문서 연결을 재인증하며 읽기 권한이 남아도 Metadata를 갱신한다. 철회된 문서의 미전송 변경은 기존 로컬 보존/Export 정책을 유지한다.

## 검증

- lint·TypeScript 검사 통과.
- Vitest 60개 파일·494개 테스트 통과. 병렬 실행의 저장 테스트 서버 준비 제한을 기존 Realtime 검사와 같은 30초로 적용했다. 단독 저장 테스트 3개도 통과했으며 DB 잠금 대기/인덱스 누락은 없었다.
- Member/Group의 Owner·비Owner·철회·Recovery·재초대, Workspace 교차 입력, Operation 충돌/8개 동시 재시도, Revision·빈/중복/철회 Member·그룹 제한과 가장 높은 Role·하위 Page를 검증했다.
- Client의 기기별 캐시·초안 순서·저장 실패·전송 전 보존·Commit 후 읽기 실패·입력 충돌·다른 기기/잘못된 경로 차단·503 결과 불명확/409 거절 구분을 검증했다.
- Local Workspace 삭제가 해당 Member 데이터만 지우는 회귀 검사를 추가했다.
- 문서 연결만 종료된 뒤 같은 Socket이 남는 재연결 문제를 수정했다. Token 발급 실패에서는 인증되지 않은 동기화를 시작하지 않으며 재인증 13개 회귀 검사 통과.
- 로컬 Build와 두 브라우저 권한 전환/멤버 제거·댓글 보존, Offline 초안·실제 Commit 후 503/새로고침/동일 Operation 재시도 및 390px 키보드 탐색 검사 2개 통과.
- CI의 최종 소스 Build·전체 E2E·Docker/512MiB·백업 복원·실제 HTTPS와 배포 소스 확인은 진행 중이다.

## 배포와 호환성

Migration 010은 기존 직접 Grant에 Revision 기본값 0을 추가하고 Group·구성원·공유·Operation 테이블을 생성한다. 기존 Page 초대 DTO·문서 CRDT·Editor Protocol 1–4를 유지한다. CI 암호화 백업 복원에 새 테이블의 실제 fixture와 총 20개 테이블 fingerprint를 포함한다. Export/Import·Snapshot은 Group·권한·인증 정보를 복제하지 않는다.

배포는 CI 통과한 같은 Commit으로 암호화 백업 → Render → Vercel 순서다. DB를 자동으로 되감지 않으며 서버 Rollback은 그룹 권한과 Task 댓글 범위를 이해하는 버전에 한정한다. 실제 Android Chrome/iOS Safari 기기는 이번 환경에서 확인하지 못했으며 Chromium 모바일 크기 검증과 구분한다.
