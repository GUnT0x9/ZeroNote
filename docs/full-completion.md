# 전체 미구현 기능 완료 목표

2026-10-02 사용자 확정: 우선순위와 관계없이 기존 체크리스트의 미완료 항목 전체를 구현·검증·배포한다. P4는 별도로 정의하지 않는다. 일부 기능 완료로 goal을 종료하지 않는다.

완료 증거는 실제 사용 UI, 저장·권한·Offline 동작, happy/edge 회귀 테스트, 빌드와 해당 배포/패키지 결과다. 환경 연결·외부 서비스 인증·실제 기기 검증이 남으면 완료로 표시하지 않는다.

## 실행 순서

1. 파일 저장/Preview/권한 → Media Editor → Templates/Command/Mobile/Export/Public Share.
2. Relation/Rollup/Formula → Knowledge/Search/Tags → Task/Comment/Member/Notification 확장.
3. 암호화 Export/기기 Pairing → 선택형 E2EE → AI Workspace.
4. Public 고급 공유/Version Compare/Branch/Review/Merge → Automation/Webhook/API Key/Integration.
5. Canvas → Capture/Extension → Desktop/Mobile 패키지 → 테마/Offline/Sync UI/운영 지원.
6. 전체 항목 증거 대조, 회귀·보안·성능·Production·패키지 검증 후 goal 종료.

현재 40개 항목을 구현·배포했고 CI와 실제 HTTPS 회귀로 확인했다. Production 증거는 [파일·Editor 기록](editor-files-release.md), [데이터 이전 기록](transfer-release.md), [Storage 기록](storage-release.md), [Public Sharing 기록](public-sharing-release.md)에 남긴다. 나머지 108개는 계속 구현 대상이다. 다음 File Property/Relation/Rollup/Formula 묶음은 [Database 확장 기준](database-advanced-plan.md)을 따른다. Formula 파서·계산 모듈은 집중 테스트 단계이며 UI·저장·배포가 남아 완료 수에 포함하지 않는다.

## 항목별 완료 증거

| 번호 | 영역                     | 요구 기능                             | 상태 / 증거                                                                                                    |
| ---- | ------------------------ | ------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 1    | Workspace / 인증         | QR 기반 기기 Pairing                  | 미구현                                                                                                         |
| 2    | Workspace / 인증         | End-to-End Encryption                 | 미구현                                                                                                         |
| 3    | Workspace / 인증         | 암호화 Workspace Export               | 구현·배포 / encrypted-export.test.ts / AES-GCM·새 Salt/IV·잘못된 암호                                          |
| 4    | Page / 문서 관리         | Page Icon                             | 미구현                                                                                                         |
| 5    | Page / 문서 관리         | Page Cover                            | 미구현                                                                                                         |
| 6    | Page / 문서 관리         | Page Template                         | 구현·배포 / 기본/저장한 문서 Template · templates.test.ts, workspace.spec.ts                                   |
| 7    | Page / 문서 관리         | 최근 방문 Page                        | 미구현                                                                                                         |
| 8    | Page / 문서 관리         | Page Duplicate                        | 구현·배포 / 독립 CRDT·파일 ID 복제 · local-first.test.ts, workspace.spec.ts                                    |
| 9    | Page / 문서 관리         | Page Lock                             | 미구현                                                                                                         |
| 10   | Editor                   | Table Block                           | 미구현                                                                                                         |
| 11   | Editor                   | Column Layout                         | 미구현                                                                                                         |
| 12   | Editor                   | Image Block                           | 구현·배포 / Image Preview · attachment-node.tsx, workspace.spec.ts                                             |
| 13   | Editor                   | Video Block                           | 구현·배포 / 실제 Video 재생 · workspace.spec.ts                                                                |
| 14   | Editor                   | Audio Block                           | 구현·배포 / 실제 Audio 재생 · workspace.spec.ts                                                                |
| 15   | Editor                   | File Block                            | 구현·배포 / Local-first 파일 Block · attachments.test.ts, workspace.spec.ts                                    |
| 16   | Editor                   | Bookmark Block                        | 미구현                                                                                                         |
| 17   | Editor                   | Embed Block                           | 미구현                                                                                                         |
| 18   | Editor                   | Math / LaTeX                          | 미구현                                                                                                         |
| 19   | Editor                   | Mermaid Diagram                       | 미구현                                                                                                         |
| 20   | Editor                   | Code 파일 첨부                        | 구현·배포 / 소스 파일 텍스트 Preview · attachments.test.ts, workspace.spec.ts                                  |
| 21   | Editor                   | Drag & Drop 파일 업로드               | 구현·배포 / Drop 좌표에 파일 첨부 · workspace.spec.ts                                                          |
| 22   | 문서 연결 / Knowledge    | Global Full-text Search               | 미구현                                                                                                         |
| 23   | 문서 연결 / Knowledge    | Search Filter                         | 미구현                                                                                                         |
| 24   | 문서 연결 / Knowledge    | Search by Property                    | 미구현                                                                                                         |
| 25   | 문서 연결 / Knowledge    | Knowledge Graph                       | 미구현                                                                                                         |
| 26   | 문서 연결 / Knowledge    | Related Pages 자동 추천               | 미구현                                                                                                         |
| 27   | 문서 연결 / Knowledge    | Broken Link 탐지                      | 미구현                                                                                                         |
| 28   | 문서 연결 / Knowledge    | Tag 시스템                            | 미구현                                                                                                         |
| 29   | Task / Project           | Subtask                               | 미구현                                                                                                         |
| 30   | Task / Project           | Task Dependency                       | 미구현                                                                                                         |
| 31   | Task / Project           | Task Label / Tag                      | 미구현                                                                                                         |
| 32   | Task / Project           | Task Estimate                         | 미구현                                                                                                         |
| 33   | Task / Project           | Recurring Task                        | 미구현                                                                                                         |
| 34   | Task / Project           | Task Reminder                         | 미구현                                                                                                         |
| 35   | Task / Project           | Task Activity Log                     | 미구현                                                                                                         |
| 36   | Task / Project           | Task별 Comment Thread                 | 미구현                                                                                                         |
| 37   | Task / Project           | Task Template                         | 미구현                                                                                                         |
| 38   | Database                 | File Property                         | 미구현                                                                                                         |
| 39   | Database                 | Formula                               | 미구현                                                                                                         |
| 40   | Database                 | Relation                              | 미구현                                                                                                         |
| 41   | Database                 | Rollup                                | 미구현                                                                                                         |
| 42   | Collaboration            | Workspace Member 관리                 | 미구현                                                                                                         |
| 43   | Collaboration            | Member Group                          | 미구현                                                                                                         |
| 44   | Collaboration            | Mention `@user`                       | 미구현                                                                                                         |
| 45   | Collaboration            | 사용자 Notification                   | 미구현                                                                                                         |
| 46   | Collaboration            | 공동 편집 Cursor 색상 설정            | 미구현                                                                                                         |
| 47   | Collaboration            | Activity Feed                         | 미구현                                                                                                         |
| 48   | Comments                 | Inline Comment                        | 미구현                                                                                                         |
| 49   | Comments                 | Block Comment                         | 미구현                                                                                                         |
| 50   | Comments                 | Comment Mention                       | 미구현                                                                                                         |
| 51   | Comments                 | Comment Reaction                      | 미구현                                                                                                         |
| 52   | Comments                 | Comment Notification                  | 미구현                                                                                                         |
| 53   | Comments                 | Task별 Comment                        | 미구현                                                                                                         |
| 54   | Local-first / Offline    | Offline 첫 방문                       | 미구현                                                                                                         |
| 55   | Local-first / Offline    | 아직 열지 않은 Page 완전 Offline 접근 | 미구현                                                                                                         |
| 56   | Local-first / Offline    | Sync History UI                       | 미구현                                                                                                         |
| 57   | Local-first / Offline    | Conflict Viewer                       | 미구현                                                                                                         |
| 58   | Local-first / Offline    | 수동 Sync                             | 구현·배포 / 좌측 Sync 메뉴 수동 실행 · workspace.spec.ts                                                       |
| 59   | Quick Capture / Inbox    | Global Keyboard Shortcut              | 미구현                                                                                                         |
| 60   | Quick Capture / Inbox    | Desktop Global Capture                | 미구현                                                                                                         |
| 61   | Quick Capture / Inbox    | Browser Extension Capture             | 미구현                                                                                                         |
| 62   | Quick Capture / Inbox    | Web Clipper                           | 미구현                                                                                                         |
| 63   | Quick Capture / Inbox    | 음성 메모                             | 미구현                                                                                                         |
| 64   | Quick Capture / Inbox    | OCR Capture                           | 미구현                                                                                                         |
| 65   | Search / Command         | Command Palette                       | 구현·배포 / Ctrl K / > Palette · commands.test.ts, workspace.spec.ts                                           |
| 66   | Search / Command         | 명령어 기반 Page 생성                 | 구현·배포 / 문서/Database/To-Do 생성 명령 · commands.test.ts, workspace.spec.ts                                |
| 67   | Search / Command         | 명령어 기반 Theme 변경                | 구현·배포 / Theme 저장/Reload · workspace.spec.ts                                                              |
| 68   | Search / Command         | 명령어 기반 이동                      | 구현·배포 / >open / >go / >이동 · commands.test.ts, workspace.spec.ts                                          |
| 69   | Search / Command         | 최근 사용 명령                        | 구현·배포 / 최근 8개 명령 저장 · commands.test.ts, workspace.spec.ts                                           |
| 70   | Search / Command         | Fuzzy Search                          | 미구현                                                                                                         |
| 71   | Search / Command         | Search Operators                      | 미구현                                                                                                         |
| 72   | Theme / UI               | Mobile 전체 Editor                    | 구현·배포 / Touch 작성/Undo·Block 도구 · workspace.spec.ts                                                     |
| 73   | Theme / UI               | 사용자 Accent Color                   | 미구현                                                                                                         |
| 74   | Theme / UI               | Font 선택                             | 미구현                                                                                                         |
| 75   | Theme / UI               | Editor Width 설정                     | 미구현                                                                                                         |
| 76   | Theme / UI               | Compact Mode                          | 미구현                                                                                                         |
| 77   | Theme / UI               | Custom Theme                          | 미구현                                                                                                         |
| 78   | Export / Import          | Markdown Export                       | 구현·배포 / portable-document.test.ts, workspace.spec.ts / 실제 Markdown 다운로드                              |
| 79   | Export / Import          | HTML Export                           | 구현·배포 / portable-archive.test.ts, workspace.spec.ts / 안전한 HTML·Pretendard 내장                          |
| 80   | Export / Import          | PDF Export                            | 구현·배포 / pdf-export.test.ts, workspace.spec.ts / 한글 PDF·Preview·페이지 나눔                               |
| 81   | Export / Import          | ZIP Export                            | 구현·배포 / zip-integrity.test.ts, portable-archive.test.ts / CRDT·첨부 ZIP·CRC                                |
| 82   | Export / Import          | Notion Import                         | 구현·배포 / portable-archive.test.ts, workspace.spec.ts / Markdown & CSV·Row 본문                              |
| 83   | Export / Import          | Obsidian Import                       | 구현·배포 / portable-archive.test.ts, workspace.spec.ts / Vault ZIP·Wiki 링크·첨부                             |
| 84   | Export / Import          | Notion Export 호환                    | 구현·배포 / portable-archive.test.ts / Markdown·CSV·첨부·Row 본문 출력                                         |
| 85   | Sharing                  | Public Page Share                     | 구현·배포 / [Public Sharing 기록](public-sharing-release.md) / CI·실제 HTTPS·보호 Cookie·선택 Scope            |
| 86   | Sharing                  | Password Share                        | 구현·배포 / [Public Sharing 기록](public-sharing-release.md) / CI·실제 HTTPS·보호 Cookie·선택 Scope            |
| 87   | Sharing                  | Temporary Share                       | 구현·배포 / [Public Sharing 기록](public-sharing-release.md) / CI·실제 HTTPS·보호 Cookie·선택 Scope            |
| 88   | Sharing                  | Burn-after-read Share                 | 구현·배포 / [Public Sharing 기록](public-sharing-release.md) / CI·실제 HTTPS·보호 Cookie·선택 Scope            |
| 89   | Sharing                  | Expiring Public Link                  | 구현·배포 / [Public Sharing 기록](public-sharing-release.md) / CI·실제 HTTPS·보호 Cookie·선택 Scope            |
| 90   | Sharing                  | Public Workspace                      | 구현·배포 / [Public Sharing 기록](public-sharing-release.md) / CI·실제 HTTPS·보호 Cookie·선택 Scope            |
| 91   | Sharing                  | SEO Page                              | 구현·배포 / [Public Sharing 기록](public-sharing-release.md) / CI·실제 HTTPS·보호 Cookie·선택 Scope            |
| 92   | Version 관리             | Version Compare                       | 미구현                                                                                                         |
| 93   | Version 관리             | Diff Viewer                           | 미구현                                                                                                         |
| 94   | Version 관리             | Branch 생성                           | 미구현                                                                                                         |
| 95   | Version 관리             | Branch Compare                        | 미구현                                                                                                         |
| 96   | Version 관리             | Review                                | 미구현                                                                                                         |
| 97   | Version 관리             | Merge                                 | 미구현                                                                                                         |
| 98   | 파일 / Media             | 파일 업로드                           | 구현·배포 / 영속 파일 저장·재시도 · integration.test.ts                                                        |
| 99   | 파일 / Media             | 이미지 업로드                         | 구현·배포 / 이미지 업로드·Preview · workspace.spec.ts                                                          |
| 100  | 파일 / Media             | 이미지 Paste                          | 구현·배포 / Image Paste · workspace.spec.ts                                                                    |
| 101  | 파일 / Media             | 이미지 Drag & Drop                    | 구현·배포 / Image Drop · workspace.spec.ts                                                                     |
| 102  | 파일 / Media             | Video                                 | 구현·배포 / 실제 Video Decode · workspace.spec.ts                                                              |
| 103  | 파일 / Media             | Audio                                 | 구현·배포 / 실제 Audio Decode · workspace.spec.ts                                                              |
| 104  | 파일 / Media             | PDF                                   | 구현·배포 / PDF Canvas/Text·손상 오류 · workspace.spec.ts                                                      |
| 105  | 파일 / Media             | File Preview                          | 구현·배포 / 이미지/미디어/PDF/소스 · workspace.spec.ts                                                         |
| 106  | 파일 / Media             | Storage 관리                          | 구현·배포 / storage.test.ts, document-files.test.ts, workspace.spec.ts / [Production 검증](storage-release.md) |
| 107  | 파일 / Media             | Attachment 권한 관리                  | 구현·배포 / Page Role·철회·Snapshot 새 파일 · integration.test.ts                                              |
| 108  | AI                       | AI 요약                               | 미구현                                                                                                         |
| 109  | AI                       | AI Rewrite                            | 미구현                                                                                                         |
| 110  | AI                       | AI 번역                               | 미구현                                                                                                         |
| 111  | AI                       | AI 문장 이어쓰기                      | 미구현                                                                                                         |
| 112  | AI                       | AI 맞춤법 수정                        | 미구현                                                                                                         |
| 113  | AI                       | AI Task 추출                          | 미구현                                                                                                         |
| 114  | AI                       | AI Page 검색                          | 미구현                                                                                                         |
| 115  | AI                       | AI Workspace 검색                     | 미구현                                                                                                         |
| 116  | AI                       | AI Q&A                                | 미구현                                                                                                         |
| 117  | AI                       | AI Database 생성                      | 미구현                                                                                                         |
| 118  | AI                       | AI Property 자동 입력                 | 미구현                                                                                                         |
| 119  | AI                       | AI Tagging                            | 미구현                                                                                                         |
| 120  | AI                       | AI 관련 Page 추천                     | 미구현                                                                                                         |
| 121  | AI                       | AI Meeting Note 정리                  | 미구현                                                                                                         |
| 122  | Automation / Integration | Automation                            | 미구현                                                                                                         |
| 123  | Automation / Integration | Trigger / Action 시스템               | 미구현                                                                                                         |
| 124  | Automation / Integration | Webhook                               | 미구현                                                                                                         |
| 125  | Automation / Integration | REST API 공개                         | 미구현                                                                                                         |
| 126  | Automation / Integration | API Key                               | 미구현                                                                                                         |
| 127  | Automation / Integration | GitHub Integration                    | 미구현                                                                                                         |
| 128  | Automation / Integration | Google Drive Integration              | 미구현                                                                                                         |
| 129  | Automation / Integration | Google Calendar Integration           | 미구현                                                                                                         |
| 130  | Automation / Integration | Slack Integration                     | 미구현                                                                                                         |
| 131  | Automation / Integration | Discord Integration                   | 미구현                                                                                                         |
| 132  | Automation / Integration | Zapier / Make 연동                    | 미구현                                                                                                         |
| 133  | Automation / Integration | RSS Integration                       | 미구현                                                                                                         |
| 134  | Canvas / Advanced        | Infinite Canvas                       | 미구현                                                                                                         |
| 135  | Canvas / Advanced        | Mind Map                              | 미구현                                                                                                         |
| 136  | Canvas / Advanced        | Whiteboard                            | 미구현                                                                                                         |
| 137  | Canvas / Advanced        | Sticky Note                           | 미구현                                                                                                         |
| 138  | Canvas / Advanced        | Diagram                               | 미구현                                                                                                         |
| 139  | Canvas / Advanced        | Page를 Canvas에 배치                  | 미구현                                                                                                         |
| 140  | Canvas / Advanced        | Database를 Canvas에 배치              | 미구현                                                                                                         |
| 141  | App / Platform           | PWA Install UX 개선                   | 미구현                                                                                                         |
| 142  | App / Platform           | Windows Desktop App                   | 미구현                                                                                                         |
| 143  | App / Platform           | macOS Desktop App                     | 미구현                                                                                                         |
| 144  | App / Platform           | Linux Desktop App                     | 미구현                                                                                                         |
| 145  | App / Platform           | Android App                           | 미구현                                                                                                         |
| 146  | App / Platform           | iOS App                               | 미구현                                                                                                         |
| 147  | App / Platform           | Browser Extension                     | 미구현                                                                                                         |
| 148  | App / Platform           | Self-hosting 공식 지원 UI             | 미구현                                                                                                         |
