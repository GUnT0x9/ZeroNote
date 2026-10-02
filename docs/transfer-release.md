# 데이터 이전 구현 기록

2026-10-02. 전체 미완료 요구 중 암호화 Workspace Export·Markdown/HTML/PDF/ZIP Export·Notion Import·Obsidian Import·Notion Export 호환을 연결했다. 전체 목표는 [항목별 기록](full-completion.md)의 148개이며, 현재 32개를 구현·로컬 검증했다. 나머지 116개를 이어서 개발한다.

## 사용 흐름

Page 메뉴 → Export에서는 해당 Page를 JSON/암호화 JSON/Markdown/HTML/PDF/ZIP/Notion 형식으로 내려받는다. 첨부나 Database가 있는 Markdown은 파일·CSV·Row 본문을 담은 ZIP으로 제공한다. Settings → 데이터 이전은 Workspace Export와 JSON/ZIP/Markdown/CSV 가져오기를 제공한다. 파일을 읽은 뒤 Page/첨부 개수와 변환 내용을 표시하고 새 Workspace를 생성한다. 인증 정보·Recovery Key·초대·접근 권한을 복원하지 않는다.

JSON과 ZeroNote ZIP은 Yjs의 전체 상태·Database 정의/값/뷰·Row 본문·참조 파일을 보존한다. ZIP Manifest는 원본 bytes를 경로로 참조해 Base64 파일을 중복 보관하지 않는다. Import는 새 Page/파일 ID로 링크를 변경하며 Dexie transaction 실패 시 부분 Workspace나 Queue를 남기지 않는다.

## 형식과 호환

- Markdown은 Heading/List/Todo/Quote/Callout/Code/Inline Mark/Page 링크/첨부를 출력한다. 파일명은 제목과 ID로 구분하며 중첩 Page와 상대 링크를 유지한다.
- HTML은 스크립트를 출력하지 않고 값과 제목을 Escape한다. 단일 Page는 미디어와 Pretendard/License를 포함하며 Workspace ZIP은 공통 글꼴 CSS를 한 번 보관한다.
- PDF는 실제 PDF 파일을 생성한다. Pretendard TTF를 Subset으로 내장하며 한글, 페이지 나눔, 이미지, Todo/List, Database의 값과 Row 본문을 출력한다. 지원하지 않는 글꼴 문자는 오류를 표시하고 HTML Export를 안내한다. 방문해 Cache된 글꼴/모듈은 Offline에서도 사용한다.
- Notion은 Markdown & CSV ZIP을 가져온다. UUID가 붙은 이름, 중첩 Page, 내부 Markdown 링크, 참조 파일과 구분 가능한 Row 본문을 복원한다. CSV는 값과 본문을 복원하고 Property는 text로 만든다. CSV에 없는 Formula/Relation 정의·권한을 추측해 생성하지 않는다.
- Obsidian은 Vault ZIP의 Markdown·`[[Wiki]]`/Alias·참조 첨부를 가져온다. 이름이 중복되면 정확한 경로를 사용하며 구분되지 않는 링크를 임의로 선택하지 않는다.
- 원본 HTML 구문은 실행하지 않고 텍스트로 보존한다. 아직 구현 중인 Table Block은 현재 셀 값을 텍스트 표로 남긴다. 구분할 수 없는 CSV Row 본문은 별도 Page로 보존하고 가져오기 전에 표시한다.
- ZIP은 50MiB·3,000 Entries를 제한하고 압축 해제 크기·경로·중복·CRC32를 검사한다. 첨부는 기존 4MiB/파일·25MiB/200개 Workspace 한도를 적용한다. 손상 파일을 가져오면서 기존 Workspace를 변경하지 않는다.

[Notion의 내보내기 형식](https://www.notion.com/help/export-your-content), [가져오기 형식](https://www.notion.com/help/import-data-into-notion), [Obsidian 문법](https://obsidian.md/help/syntax)에 맞춰 Markdown/CSV를 처리한다. 데이터 이전은 API를 통해 해당 서비스 계정을 연결하는 기능과 별개다.

## 암호화 백업

암호화는 이 기기에서 PBKDF2-SHA-256 600,000회·난수 32-byte Salt·AES-256-GCM·난수 12-byte IV를 적용한다. Envelope Version/암호·KDF 설정을 인증하고 고정된 KDF 반복 수를 검사한다. 같은 백업도 매번 다른 Ciphertext를 생성하며 틀린 암호·변조·손상 파일은 거절한다. 암호는 저장/전송하지 않고 저장 성공 후 입력을 비운다. 서버 저장은 현재 Alpha 계약대로이며 선택형 E2EE는 별도 미완료 항목이다.

## 검증과 배포

로컬 186 Unit/Server Tests와 기존 전체 흐름을 포함한 18 Browser Tests가 통과했다. 이후 모호한 Row/CSV 제목 한도의 edge 회귀를 추가했다. 한글 PDF를 실제 PDF Preview에서 읽고, HTML 파일의 Pretendard 글꼴이 로드되는지 확인한다. 암호 불일치/잘못된 복호화, ZIP CRC/경로/크기, Import 저장 공간 오류의 rollback도 검증한다.

최종 lint/type-check/Build와 정확한 Commit의 CI를 통과한 뒤 Render → Vercel 순서로 수동 배포한다. 실제 HTTPS의 데이터 이전, 기존 최대 파일/Recovery/Offline PDF를 재검증한 결과를 아래에 추가한다. 실제 Android/iOS 기기와 남은 전체 요구는 아직 미완료다.

## 변경 파일과 이유

| 파일                                                                                              | 이유                                         |
| ------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| [.gitignore](../.gitignore)                                                                       | 의존성·공유 Module·생성 Asset 구성           |
| [apps/web/package.json](../apps/web/package.json)                                                 | 의존성·공유 Module·생성 Asset 구성           |
| [apps/web/public/sw.js](../apps/web/public/sw.js)                                                 | 글꼴·License 준비와 Offline 정적 Asset Cache |
| [apps/web/scripts/prepare-pdf.mjs](../apps/web/scripts/prepare-pdf.mjs)                           | 글꼴·License 준비와 Offline 정적 Asset Cache |
| [apps/web/src/app/globals.css](../apps/web/src/app/globals.css)                                   | 기존 Token과 맞춘 이전 폼 간격·색상          |
| [apps/web/src/components/block-editor.tsx](../apps/web/src/components/block-editor.tsx)           | File 크기를 읽기 전에 검사                   |
| [apps/web/src/components/dialogs.tsx](../apps/web/src/components/dialogs.tsx)                     | Page/Settings의 데이터 이전 진입점           |
| [apps/web/src/components/document-view.tsx](../apps/web/src/components/document-view.tsx)         | Page/Settings의 데이터 이전 진입점           |
| [apps/web/src/components/transfer-dialog.tsx](../apps/web/src/components/transfer-dialog.tsx)     | 다운로드·가져오기·변환 미리보기 UI 연결      |
| [apps/web/src/fonts/Pretendard-LICENSE.txt](../apps/web/src/fonts/Pretendard-LICENSE.txt)         | 글꼴·License 준비와 Offline 정적 Asset Cache |
| [apps/web/src/lib/attachments.test.ts](../apps/web/src/lib/attachments.test.ts)                   | 정상 사용과 실패·권한·Offline 회귀 검증      |
| [apps/web/src/lib/attachments.ts](../apps/web/src/lib/attachments.ts)                             | File 크기를 읽기 전에 검사                   |
| [apps/web/src/lib/encrypted-export.test.ts](../apps/web/src/lib/encrypted-export.test.ts)         | 정상 사용과 실패·권한·Offline 회귀 검증      |
| [apps/web/src/lib/encrypted-export.ts](../apps/web/src/lib/encrypted-export.ts)                   | 기기에서 암호화·복호화 및 Envelope 검증      |
| [apps/web/src/lib/local-first.test.ts](../apps/web/src/lib/local-first.test.ts)                   | 정상 사용과 실패·권한·Offline 회귀 검증      |
| [apps/web/src/lib/pdf-export.test.ts](../apps/web/src/lib/pdf-export.test.ts)                     | 정상 사용과 실패·권한·Offline 회귀 검증      |
| [apps/web/src/lib/pdf-export.ts](../apps/web/src/lib/pdf-export.ts)                               | Pretendard를 포함한 실제 PDF 생성            |
| [apps/web/src/lib/portable-archive.test.ts](../apps/web/src/lib/portable-archive.test.ts)         | 정상 사용과 실패·권한·Offline 회귀 검증      |
| [apps/web/src/lib/portable-archive.ts](../apps/web/src/lib/portable-archive.ts)                   | ZIP·Notion·Obsidian과 CSV/Row 본문 이전      |
| [apps/web/src/lib/transfer.test.ts](../apps/web/src/lib/transfer.test.ts)                         | 정상 사용과 실패·권한·Offline 회귀 검증      |
| [apps/web/src/lib/transfer.ts](../apps/web/src/lib/transfer.ts)                                   | 다운로드·가져오기·변환 미리보기 UI 연결      |
| [apps/web/src/lib/workspace.ts](../apps/web/src/lib/workspace.ts)                                 | Page별 Export와 Import transaction           |
| [apps/web/src/lib/zip-integrity.test.ts](../apps/web/src/lib/zip-integrity.test.ts)               | 정상 사용과 실패·권한·Offline 회귀 검증      |
| [apps/web/src/lib/zip-integrity.ts](../apps/web/src/lib/zip-integrity.ts)                         | ZIP 크기·디렉터리·CRC 검증                   |
| [docs/feature-checklist.md](../docs/feature-checklist.md)                                         | 전체 범위·형식·채택 근거·검증 기록           |
| [docs/full-completion.md](../docs/full-completion.md)                                             | 전체 범위·형식·채택 근거·검증 기록           |
| [docs/product/19-decision-log.md](../docs/product/19-decision-log.md)                             | 전체 범위·형식·채택 근거·검증 기록           |
| [docs/transfer-release.md](../docs/transfer-release.md)                                           | 전체 범위·형식·채택 근거·검증 기록           |
| [packages/shared/package.json](../packages/shared/package.json)                                   | 의존성·공유 Module·생성 Asset 구성           |
| [packages/shared/src/index.ts](../packages/shared/src/index.ts)                                   | 의존성·공유 Module·생성 Asset 구성           |
| [packages/shared/src/portable-document.test.ts](../packages/shared/src/portable-document.test.ts) | 정상 사용과 실패·권한·Offline 회귀 검증      |
| [packages/shared/src/portable-document.ts](../packages/shared/src/portable-document.ts)           | Yjs/Markdown/HTML 변환과 안정적인 링크       |
| [pnpm-lock.yaml](../pnpm-lock.yaml)                                                               | 의존성·공유 Module·생성 Asset 구성           |
| [tests/workspace.spec.ts](../tests/workspace.spec.ts)                                             | 정상 사용과 실패·권한·Offline 회귀 검증      |
