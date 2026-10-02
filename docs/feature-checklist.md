# ZeroNote 기능 체크리스트

2026-10-02 코드 대조와 Database·파일·Template·Command·Mobile Editor 구현 반영. [x]는 사용 가능한 기능이며 후속 항목을 완료로 표시하지 않는다.

- History/Restore는 Owner 전용 Online Snapshot과 새 비공유 Page 복구다. 원본 덮어쓰기, Compare, Branch/Merge는 포함하지 않는다.
- Generic Database는 기존 Task Row 저장 구조를 재사용하며 13가지 속성 종류와 Saved View를 제공한다. File Property는 파일 저장 기반과 함께 후속 구현한다.
- Start Date/End Date는 Task 기본 속성에 추가했으며 표시 속성에서 선택하거나 상세에서 편집한다.
- 최근 방문은 Search의 최근 목록과 별도의 Sidebar 기능을 구분한다.
- 좌측 상단 Sync 상태에서 수동 동기화를 실행한다. 파일·문서 모두 서버 Commit 전에는 완료로 표시하지 않는다.
- 전체 미완료 항목은 [전체 완료 목표](full-completion.md)에서 추적한다. 이번 추가 기능의 검증/배포 상태는 [파일·Editor 확장 기록](editor-files-release.md)에 기록한다. 일부 기능 구현으로 전체 목표를 종료하지 않는다.
- 파일은 4MiB/개, Workspace 25MiB/200개다. PDF·Audio·Video·이미지·소스 미리보기와 파일을 포함한 Export/Import/Snapshot 복구를 제공한다. Storage 관리 UI와 영구 정리는 계속 구현 대상이다.
- Template은 기본 문서 3개와 저장한 Page 재사용이다. Task Template은 별도 구현 대상이다.

## Workspace / 인증

- [x] 회원가입 없이 사용
- [x] Device Identity 생성
- [x] P-256 Challenge 기반 기기 인증
- [x] Workspace 생성
- [x] Workspace 전환
- [x] Workspace 삭제
- [x] Recovery Key 발급
- [x] Recovery Key 복사
- [x] Recovery Key 파일 저장
- [x] Recovery Key로 Workspace 복구
- [x] Recovery Key 재발급
- [x] 연결된 기기 조회
- [x] 다른 기기 접근 철회
- [ ] QR 기반 기기 Pairing
- [ ] End-to-End Encryption
- [ ] 암호화 Workspace Export

---

## Page / 문서 관리

- [x] 일반 Page 생성
- [x] Project / Task Database Page 생성
- [x] Nested Page
- [x] 하위 Page 생성
- [x] Page 이동
- [x] Trash 이동
- [x] Trash에서 복원
- [x] Page 제목 변경
- [x] Breadcrumb
- [ ] Page Icon
- [ ] Page Cover
- [x] Page Template
- [x] Favorite Page
- [ ] 최근 방문 Page
- [x] Page Duplicate
- [ ] Page Lock
- [x] Page History
- [x] Page Version Restore

---

## Editor

- [x] Tiptap 기반 Block Editor
- [x] Slash Command
- [x] Markdown Shortcut
- [x] Heading 1
- [x] Heading 2
- [x] Heading 3
- [x] Bullet List
- [x] Ordered List
- [x] Todo
- [x] Toggle
- [x] Callout
- [x] Code Block
- [x] Syntax Highlighting
- [x] Page Mention
- [x] Block 이동
- [x] Block 복제
- [x] Block 삭제
- [x] Todo → Task 변환
- [x] Undo / Redo
- [x] Quote Block
- [x] Divider
- [ ] Table Block
- [ ] Column Layout
- [x] Image Block
- [x] Video Block
- [x] Audio Block
- [x] File Block
- [ ] Bookmark Block
- [ ] Embed Block
- [ ] Math / LaTeX
- [ ] Mermaid Diagram
- [x] Code 파일 첨부
- [x] Drag & Drop 파일 업로드

---

## 문서 연결 / Knowledge

- [x] `[[Page]]` Mention
- [x] Page ID 기반 안정적인 링크
- [x] Page 이름 변경 후 링크 유지
- [x] Backlinks
- [x] Local Search
- [ ] Global Full-text Search
- [ ] Search Filter
- [ ] Search by Property
- [ ] Knowledge Graph
- [ ] Related Pages 자동 추천
- [ ] Broken Link 탐지
- [ ] Tag 시스템

---

## Task / Project

- [x] Task 생성
- [x] Task 제목
- [x] Status
- [x] Assignee
- [x] Due Date
- [x] Priority
- [x] Table View
- [x] Board View
- [x] Board Drag & Drop
- [x] Task 검색
- [x] Task 상세 화면
- [x] Task Pagination
- [x] Todo → Task 변환
- [x] Start Date
- [x] End Date
- [ ] Subtask
- [ ] Task Dependency
- [ ] Task Label / Tag
- [ ] Task Estimate
- [ ] Recurring Task
- [ ] Task Reminder
- [ ] Task Activity Log
- [ ] Task별 Comment Thread
- [ ] Task Template

---

## Database

- [x] Task 전용 Database
- [x] Table View
- [x] Board View
- [x] Generic Database
- [x] Custom Property 생성
- [x] Text Property
- [x] Number Property
- [x] Select Property
- [x] Multi Select Property
- [x] Status Property
- [x] Date Property
- [x] Checkbox Property
- [x] Person Property
- [x] URL Property
- [x] Email Property
- [x] Phone Property
- [ ] File Property
- [x] Created Time Property
- [x] Updated Time Property
- [ ] Formula
- [ ] Relation
- [ ] Rollup
- [x] Database Filter
- [x] Database Sort
- [x] Database Group
- [x] Database Saved View
- [x] Calendar View
- [x] Timeline View
- [x] Gallery View
- [x] List View

---

## Collaboration

- [x] 실시간 공동 편집
- [x] Yjs CRDT
- [x] Presence
- [x] 동시 편집 충돌 처리
- [x] Editor 권한
- [x] Commenter 권한
- [x] Viewer 권한
- [x] Page 단위 Share
- [x] 하위 Page Share
- [x] 초대 링크 생성
- [x] 초대 취소
- [x] 사용자 접근 권한 철회
- [ ] Workspace Member 관리
- [ ] Member Group
- [ ] Mention `@user`
- [ ] 사용자 Notification
- [ ] 공동 편집 Cursor 색상 설정
- [ ] Activity Feed

---

## Comments

- [x] Page Comment
- [x] Comment Reply
- [x] Comment Resolve
- [x] Comment Reopen
- [x] Offline Comment Queue
- [x] 재연결 후 Comment 전송
- [ ] Inline Comment
- [ ] Block Comment
- [ ] Comment Mention
- [ ] Comment Reaction
- [ ] Comment Notification
- [ ] Task별 Comment

---

## Local-first / Offline

- [x] IndexedDB 저장
- [x] Local-first 작성
- [x] Offline 작성
- [x] Offline 상태에서 Reload
- [x] 재연결 후 Sync
- [x] Operation Queue
- [x] 서버 Commit 확인 후 저장 완료 표시
- [x] 충돌 재적용
- [x] 접근 철회 후 로컬 데이터 보존
- [x] 원격 Page 삭제 후 로컬 보존
- [x] Service Worker
- [x] App Shell Cache
- [ ] Offline 첫 방문
- [ ] 아직 열지 않은 Page 완전 Offline 접근
- [ ] Sync History UI
- [ ] Conflict Viewer
- [x] 수동 Sync
- [x] CRDT Update Log 정리 / 압축

---

## Quick Capture / Inbox

- [x] Inbox
- [x] Quick Capture
- [x] 여러 줄 입력
- [x] 저장 위치 선택
- [x] Ctrl / Cmd + Enter 저장
- [x] Mobile Quick Capture
- [ ] Global Keyboard Shortcut
- [ ] Desktop Global Capture
- [ ] Browser Extension Capture
- [ ] Web Clipper
- [ ] 음성 메모
- [ ] OCR Capture

---

## Search / Command

- [x] Local Page Search
- [x] 최근 Page 표시
- [x] Keyboard Search Navigation
- [x] Command Palette
- [x] `Ctrl + K`
- [x] 명령어 기반 Page 생성
- [x] 명령어 기반 Theme 변경
- [x] 명령어 기반 이동
- [x] 최근 사용 명령
- [ ] Fuzzy Search
- [ ] Search Operators

---

## Theme / UI

- [x] Light Theme
- [x] Dark Theme
- [x] System Theme
- [x] Pretendard 자체 제공
- [x] Desktop UI
- [x] Mobile 읽기 UI
- [x] Mobile Comment
- [x] Mobile Quick Capture
- [x] Mobile 전체 Editor
- [ ] 사용자 Accent Color
- [ ] Font 선택
- [ ] Editor Width 설정
- [ ] Compact Mode
- [ ] Custom Theme

---

## Export / Import

- [x] Workspace Export
- [x] JSON Export
- [x] Workspace Import
- [x] Page ID 재매핑
- [x] Mention ID 재매핑
- [x] Task 데이터 보존
- [x] 인증 Secret Export 제외
- [x] 손상 Import 검증
- [x] 순환 Page Tree Import 거절
- [ ] Markdown Export
- [ ] HTML Export
- [ ] PDF Export
- [ ] ZIP Export
- [ ] Notion Import
- [ ] Obsidian Import
- [ ] Notion Export 호환

---

## Sharing

- [x] Private Page Share
- [x] Invite Link
- [x] Editor / Commenter / Viewer
- [x] One-time Invite
- [x] Invite Expiration
- [x] Invite Revoke
- [ ] Public Page Share
- [ ] Password Share
- [ ] Temporary Share
- [ ] Burn-after-read Share
- [ ] Expiring Public Link
- [ ] Public Workspace
- [ ] SEO Page

---

## Version 관리

- [x] 자동 Snapshot
- [x] Version History
- [x] Version Preview
- [x] Version Restore
- [ ] Version Compare
- [ ] Diff Viewer
- [ ] Branch 생성
- [ ] Branch Compare
- [ ] Review
- [ ] Merge

---

## 파일 / Media

- [x] 파일 업로드
- [x] 이미지 업로드
- [x] 이미지 Paste
- [x] 이미지 Drag & Drop
- [x] Video
- [x] Audio
- [x] PDF
- [x] File Preview
- [ ] Storage 관리
- [x] Attachment 권한 관리

---

## AI

- [ ] AI 요약
- [ ] AI Rewrite
- [ ] AI 번역
- [ ] AI 문장 이어쓰기
- [ ] AI 맞춤법 수정
- [ ] AI Task 추출
- [ ] AI Page 검색
- [ ] AI Workspace 검색
- [ ] AI Q&A
- [ ] AI Database 생성
- [ ] AI Property 자동 입력
- [ ] AI Tagging
- [ ] AI 관련 Page 추천
- [ ] AI Meeting Note 정리

---

## Automation / Integration

- [ ] Automation
- [ ] Trigger / Action 시스템
- [ ] Webhook
- [ ] REST API 공개
- [ ] API Key
- [ ] GitHub Integration
- [ ] Google Drive Integration
- [ ] Google Calendar Integration
- [ ] Slack Integration
- [ ] Discord Integration
- [ ] Zapier / Make 연동
- [ ] RSS Integration

---

## Canvas / Advanced

- [ ] Infinite Canvas
- [ ] Mind Map
- [ ] Whiteboard
- [ ] Sticky Note
- [ ] Diagram
- [ ] Page를 Canvas에 배치
- [ ] Database를 Canvas에 배치

---

## App / Platform

- [x] Web App
- [x] PWA 기반 구조
- [x] Web App Manifest
- [x] Service Worker
- [ ] PWA Install UX 개선
- [ ] Windows Desktop App
- [ ] macOS Desktop App
- [ ] Linux Desktop App
- [ ] Android App
- [ ] iOS App
- [ ] Browser Extension
- [ ] Self-hosting 공식 지원 UI

---

# 다음 우선순위

## P0

- [x] Generic Database Property System
- [x] Database Filter / Sort / Group
- [x] Calendar View
- [x] Timeline View
- [x] Gallery View
- [x] Version History

## P1

- [x] File / Image Upload
- [x] Command Palette
- [x] Templates
- [ ] Public Share
- [x] Full Mobile Editing
- [ ] Markdown / PDF Export

## P2

- [ ] Relation
- [ ] Rollup
- [ ] Formula
- [ ] Knowledge Graph
- [ ] AI Workspace
- [ ] E2EE
- [ ] QR Device Pairing

## P3

- [ ] Automation
- [ ] Webhook
- [ ] Integrations
- [ ] Canvas
- [ ] Desktop App
