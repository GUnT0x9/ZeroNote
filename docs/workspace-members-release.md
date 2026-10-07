# Workspace Member·Group 출시 검증

2026-10-07 구현·배포·실제 HTTPS 검증 완료. 전체 미완료 요구 42(Workspace Member 관리)·43(Member Group)를 제공한다. 앱 소스는 `86c9a0126772637b1ff79581fb4f21fb4c9c7dca`이며 완료 수는 62/148, 남은 요구는 86개다. 전체 목표는 계속 진행한다.

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
- 권한 확인 뒤 대기하던 문서 Commit이 Role 변경/Member 제거 후에도 승인되는 두 race를 재현하고, Content/Page lock 이후 같은 Transaction에서 현재 편집 권한을 다시 검사하도록 수정했다. 두 거절 검사를 포함한 Member·Realtime·저장 통합 56개 테스트와 lint·TypeScript 검사 통과.
- 최종 소스 CI·Docker/512MiB·암호화 백업 복원과 실제 HTTPS 검증은 아래와 같이 모두 통과했다.

## 배포와 호환성

Migration 010은 기존 직접 Grant에 Revision 기본값 0을 추가하고 Group·구성원·공유·Operation 테이블을 생성한다. 기존 Page 초대 DTO·문서 CRDT·Editor Protocol 1–4를 유지한다. CI 암호화 백업 복원에 새 테이블의 실제 fixture와 총 20개 테이블 fingerprint를 포함한다. Export/Import·Snapshot은 Group·권한·인증 정보를 복제하지 않는다.

배포는 CI 통과한 같은 Commit으로 암호화 백업 → Render → Vercel 순서다. DB를 자동으로 되감지 않으며 서버 Rollback은 그룹 권한과 Task 댓글 범위를 이해하는 버전에 한정한다. 실제 Android Chrome/iOS Safari 기기는 이번 환경에서 확인하지 못했으며 Chromium 모바일 크기 검증과 구분한다.

## 최종 CI·Production 증거

[CI 37581035491](https://github.com/GUnT0x9/ZeroNote/actions/runs/37581035491)는 앱 소스 `86c9a01`의 lint·type-check·499 Tests/60 files·Web/Server Build·31 E2E(3.8분)·서버 Docker Build·512MiB Health·암호화 백업 복원을 통과했다. PostgreSQL 17 복원 DB의 Migration 10개와 Group/구성원/공유/Operation fixture를 포함한 20개 테이블의 fingerprint를 확인했다. 최초 소스 `28d0174`의 CI는 대기 중인 문서 승인 race 보강으로 중단했다.

배포 전 PostgreSQL 17/age 암호화 백업을 생성하고 최근 4개를 보관했다. Render `dep-db2udhfavr4c739584rg` Live/Health 200 → Vercel `dpl_BijNPrnoFxt5QFt8tp8Sz8C36yfw` Ready 순서로 같은 소스를 배포했다. Vercel Production Alias·프로젝트·앱 Commit/GitHub Commit SHA가 일치한다. [Beta 사이트](https://zeronote-kohl.vercel.app)의 Settings → 멤버와 그룹에서 사용할 수 있다. 이후 문서 Commit은 앱 소스를 바꾸지 않는다.

실제 HTTPS Chromium에서 9개 흐름이 5.0분에 모두 통과했다.

| 흐름                                                                        | 결과          |
| --------------------------------------------------------------------------- | ------------- |
| 멤버 이름·그룹·Viewer/Editor/Commenter 전환·공동 편집·제거·댓글 보존        | 통과 · 37.6초 |
| Offline 그룹 초안/새로고침·Commit 후 503·동일 Operation 재시도·390px 키보드 | 통과 · 24.5초 |
| Task 댓글 범위·초안·Offline 답글·Commenter/Viewer                           | 통과 · 41.1초 |
| 삭제 Task 실패 댓글/초안·모바일 Focus                                       | 통과 · 28.7초 |
| Subtask·Dependency·Label·Estimate·Template·Offline·Snapshot                 | 통과 · 33.6초 |
| 전체 검색·필터·연산자·Fuzzy·미전송 편집                                     | 통과 · 31.2초 |
| Page 초대·실시간 편집·댓글·Viewer·Recovery                                  | 통과 · 29.7초 |
| 모바일 Touch 편집·Capture·Comments                                          | 통과 · 19.2초 |
| File·Formula·Relation·Rollup·Rename·Offline·Snapshot                        | 통과 · 40.0초 |

검증 종료 후 운영 DB는 Migration 10개·Member Index 3개·댓글 Scope Index 1개·Editor Protocol 1–4, 다른 Workspace의 Group Member/Grant 0건, Checkpoint 검색 Index 누락 0건, 검증용 Workspace 0개, 11,902,976 bytes였다. 실제 Android Chrome/iOS Safari 기기는 접근 가능한 실기기가 없어 별도 확인하지 못했다. 모바일 결과는 Chromium Touch/390px viewport 검사다.

## 변경 파일과 이유

| 파일                                                            | 변경 이유                                                     |
| --------------------------------------------------------------- | ------------------------------------------------------------- |
| `.github/workflows/ci.yml`                                      | Migration 10·새 Group fixture와 20개 테이블 암호화 복원 검증  |
| `apps/server/src/database/attachment-store.ts`                  | Group 접근 계산·승인/Revision/Operation과 저장 직전 권한 검증 |
| `apps/server/src/database/comment-store.ts`                     | Group 접근 계산·승인/Revision/Operation과 저장 직전 권한 검증 |
| `apps/server/src/database/document-store.ts`                    | Group 접근 계산·승인/Revision/Operation과 저장 직전 권한 검증 |
| `apps/server/src/database/locks.ts`                             | 문서·댓글·파일·공유·멤버 변경의 공통 Content lock 상수        |
| `apps/server/src/database/member-store.ts`                      | Group 접근 계산·승인/Revision/Operation과 저장 직전 권한 검증 |
| `apps/server/src/database/migrations.ts`                        | 기존 Grant 보존과 Member/Group 저장 Schema 등록               |
| `apps/server/src/database/migrations/010-workspace-members.sql` | 기존 Grant 보존과 Member/Group 저장 Schema 등록               |
| `apps/server/src/database/public-share-store.ts`                | Group 접근 계산·승인/Revision/Operation과 저장 직전 권한 검증 |
| `apps/server/src/database/repository.ts`                        | Group 접근 계산·승인/Revision/Operation과 저장 직전 권한 검증 |
| `apps/server/src/database/snapshot-store.ts`                    | Group 접근 계산·승인/Revision/Operation과 저장 직전 권한 검증 |
| `apps/server/src/member-routes.ts`                              | 기존 인증·Origin 경계에서 Member 관리 API 등록                |
| `apps/server/src/member-service.ts`                             | 서버 Identity/권한 확인과 Commit 후 연결 재인증               |
| `apps/server/src/members.test.ts`                               | 권한·재시도·충돌·Offline·캐시·실시간 재인증과 저장 회귀 검증  |
| `apps/server/src/migrations.test.ts`                            | 권한·재시도·충돌·Offline·캐시·실시간 재인증과 저장 회귀 검증  |
| `apps/server/src/routes.ts`                                     | 기존 인증·Origin 경계에서 Member 관리 API 등록                |
| `apps/server/src/services.ts`                                   | 서버 Identity/권한 확인과 Commit 후 연결 재인증               |
| `apps/server/src/storage.test.ts`                               | 권한·재시도·충돌·Offline·캐시·실시간 재인증과 저장 회귀 검증  |
| `apps/web/src/app/globals.css`                                  | Settings의 Member/Group UI·키보드/모바일과 개별 공유 표시     |
| `apps/web/src/components/context-panel.tsx`                     | Settings의 Member/Group UI·키보드/모바일과 개별 공유 표시     |
| `apps/web/src/components/dialogs.tsx`                           | Settings의 Member/Group UI·키보드/모바일과 개별 공유 표시     |
| `apps/web/src/components/members-dialog.tsx`                    | Settings의 Member/Group UI·키보드/모바일과 개별 공유 표시     |
| `apps/web/src/lib/document-files.test.ts`                       | 권한·재시도·충돌·Offline·캐시·실시간 재인증과 저장 회귀 검증  |
| `apps/web/src/lib/documents.ts`                                 | 열린 Socket의 문서 재인증·Token 실패 보존과 Metadata 갱신     |
| `apps/web/src/lib/local-first.test.ts`                          | 권한·재시도·충돌·Offline·캐시·실시간 재인증과 저장 회귀 검증  |
| `apps/web/src/lib/members.test.ts`                              | 권한·재시도·충돌·Offline·캐시·실시간 재인증과 저장 회귀 검증  |
| `apps/web/src/lib/members.ts`                                   | 기기별 캐시/초안·전송 전 Queue·동일 변경 재시도·ACK 구분      |
| `apps/web/src/lib/workspace.ts`                                 | Workspace 로컬 삭제 시 해당 Member 캐시·Queue·초안만 정리     |
| `docs/api.md`                                                   | API·권한·동작 기본안과 검증/배포·호환성 근거 기록             |
| `docs/product/07-collaboration-spec.md`                         | API·권한·동작 기본안과 검증/배포·호환성 근거 기록             |
| `docs/product/08-permission-model.md`                           | API·권한·동작 기본안과 검증/배포·호환성 근거 기록             |
| `docs/product/15-data-model.md`                                 | API·권한·동작 기본안과 검증/배포·호환성 근거 기록             |
| `docs/product/16-api-design.md`                                 | API·권한·동작 기본안과 검증/배포·호환성 근거 기록             |
| `docs/product/19-decision-log.md`                               | API·권한·동작 기본안과 검증/배포·호환성 근거 기록             |
| `docs/workspace-members-plan.md`                                | API·권한·동작 기본안과 검증/배포·호환성 근거 기록             |
| `docs/workspace-members-release.md`                             | API·권한·동작 기본안과 검증/배포·호환성 근거 기록             |
| `packages/shared/src/identity-schema.ts`                        | 공유 Zod 계약과 순환 import를 피하는 Identity 기본 Schema     |
| `packages/shared/src/index.ts`                                  | 공유 Zod 계약과 순환 import를 피하는 Identity 기본 Schema     |
| `packages/shared/src/members.test.ts`                           | 권한·재시도·충돌·Offline·캐시·실시간 재인증과 저장 회귀 검증  |
| `packages/shared/src/members.ts`                                | 공유 Zod 계약과 순환 import를 피하는 Identity 기본 Schema     |
| `tests/workspace.spec.ts`                                       | 권한·재시도·충돌·Offline·캐시·실시간 재인증과 저장 회귀 검증  |
| `docs/beta-validation.md`                                       | 최신 운영 소스·Migration·HTTPS 검증 결과 기록                 |
| `docs/feature-checklist.md`                                     | 실제 검증된 Member/Group 체크와 전체 완료 수 갱신             |
| `docs/full-completion.md`                                       | 148개 요구의 두 완료 증거와 남은 86개 범위 유지               |
| `docs/product/18-roadmap.md`                                    | Member/Group 배포 결과와 다음 협업 기능 순서 기록             |
