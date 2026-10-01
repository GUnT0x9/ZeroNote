# ZeroNote 초대 Beta

회원가입 없이 문서를 작성하고 Page에 사람을 초대하는 Local-first Workspace입니다. Pretendard를 자체 제공하며 Light/Dark/System Theme과 Mobile 읽기·Quick Capture·Comments를 지원합니다.

[ZeroNote Beta 열기](https://zeronote-kohl.vercel.app). 새 Workspace에는 운영자가 전달하는 일회성 Beta 코드가 필요합니다. Page 초대 수락과 기존 Workspace Recovery는 코드 없이 이용할 수 있습니다.

## 코드 저장소

[GUnT0x9/ZeroNote](https://github.com/GUnT0x9/ZeroNote)에서 관리합니다. 기본 브랜치는 `main`이며 기능 작업은 `codex/<topic>` 브랜치에서 진행합니다. GitHub Actions에서 lint·TypeScript·단위/통합 테스트·Build·Browser 테스트를 검증합니다.

```bash
git clone https://github.com/GUnT0x9/ZeroNote.git
cd ZeroNote
```

## 실행

Node.js 24와 pnpm 11을 사용합니다. 이 디렉터리는 상위 프로젝트와 분리된 pnpm Workspace입니다.

```bash
pnpm install --frozen-lockfile
cp .env.example .env
pnpm db:start
pnpm dev
```

[http://localhost:3000](http://localhost:3000)에서 Workspace를 만들고 표시되는 Recovery Key를 보관하세요. 생성한 문서와 Task는 테스트 데이터가 아닌 브라우저의 IndexedDB와 PostgreSQL에 저장됩니다. 초대 링크는 다른 브라우저 Profile에서 열어야 다른 기기를 테스트할 수 있습니다.

`db:start`는 WSL/Linux에 설치된 PostgreSQL을 사용하고 프로젝트별 Linux 홈 디렉터리에 별도 Cluster를 만듭니다. 개발 Cluster는 `127.0.0.1:55432`에서만 접속 가능한 trust 인증입니다. 설치된 PostgreSQL이 없다면 Docker DB 또는 외부 PostgreSQL을 사용하고 `DATABASE_URL`을 설정하세요. Docker를 선택하면 native Cluster와 같은 포트를 동시에 쓰지 않도록 조정해야 합니다.

```bash
# Docker DB를 선택하는 경우 .env에 POSTGRES_PASSWORD를 추가합니다.
docker compose up -d db
# DATABASE_URL을 비밀번호를 포함한 접속 문자열로 변경합니다.
pnpm db:migrate
```

Fastify는 `3001`, Next.js는 `3000`에서 실행합니다. Next.js가 `/v1`과 `/collaboration`을 같은 Origin으로 Proxy합니다. `API_INTERNAL_ORIGIN`으로 API 대상 주소를 바꿀 수 있습니다. Server 환경변수는 Zod로 검증합니다.

## 검증

```bash
pnpm lint
pnpm type-check
pnpm test
pnpm build
pnpm exec playwright install chromium
pnpm test:e2e
```

`test`는 실제 PostgreSQL에 연결하는 API·WebSocket 통합 테스트도 포함합니다. 테스트는 생성한 Workspace만 정리하며 전체 DB를 초기화하지 않습니다. `test:e2e`는 별도 Production Build를 만들고 Web 3002/API 3003에서 실행합니다. 개발 서버와 Build 산출물·포트를 공유하지 않습니다. Offline 새로고침은 개발용 HMR 서버 대신 `next build` 결과에서 검증하세요.

배포용 UI를 로컬에서 확인하려면 `pnpm build` 후 `pnpm start`를 사용합니다. 개발 실행과 같은 포트를 사용하므로 먼저 개발 서버를 종료하세요.

## 구현 범위

- Device P-256 Challenge 인증, Workspace 생성·전환·Recovery·Key 재발급·기기 철회.
- Nested Pages, Markdown Shortcut·Slash Commands·Code Highlight·Todo·Toggle·Callout·안정적인 Page Mention, Backlinks와 로컬 검색.
- Task Table·Board·상세 본문, Assignee·날짜 전용 Due Date·Priority, Todo의 Task 변환.
- Page 단위 Editor/Commenter/Viewer 초대, 하위 Page 범위 옵션, 일회성 초대와 지속 Grant, 실시간 편집·Presence, Thread·답글·해결·Offline Comment Queue.
- y-indexeddb와 Dexie Local 저장, 정적 App Shell Cache, Metadata Operation ID/Revision, PostgreSQL Commit 후 동기화 표시, 충돌 재적용 및 접근 철회 후 로컬 복사본 Export.
- Inbox·Quick Capture, Trash·복원, Version 1 Export·Import와 Page ID 재매핑.
- 일회성 Beta 코드·Workspace 생성 자격, Owner Snapshot 기록·읽기 전용 미리보기·비공유 새 Page 복구, 버전 Migration·Checkpoint/로그 정리·서버 저장 용량 관리.

일반 Database Property Builder, Calendar/Timeline/Gallery, Formula/Relation/Rollup, Canvas, Branch/Merge, Public/Burn Share, 파일 업로드, Automation, Native Desktop은 후속 범위입니다.

## 구조

```text
apps/web        Next.js App Router, Tiptap UI, Local 저장 및 동기화
apps/server     Fastify REST, Hocuspocus, service/repository와 PostgreSQL
packages/shared Zod 계약, 권한·Task·CRDT Projection 공통 함수
docs/product    21개 승인된 제품 문서
tests           Playwright 사용자 흐름 검증
scripts         개발·실행·로컬 PostgreSQL 설정
```

문서 제목·본문·Task는 Yjs가 편집 원본입니다. 서버는 Page Tree·삭제·권한을 관리하고 PostgreSQL의 목록용 제목은 CRDT에서 파생합니다. 문서별/Database별 동기화 단위를 사용합니다. `onSynced`와 WebSocket 연결을 저장 완료 근거로 사용하지 않으며 `/commit`의 DB 저장 확인 후에만 표시합니다.

Local 저장 이후 전송합니다. 네트워크 없이 처음 방문하거나 아직 Cache하지 않은 문서는 열 수 없습니다. 서버 Recovery는 동기화된 데이터까지 복구합니다. 브라우저 저장소 삭제 전에는 Export를 권장합니다. Beta에서는 Commit된 Checkpoint에 포함된 Update 로그를 정리하고 Operation Hash는 유지합니다.

## 배포 설정

Vercel Web·Render 서버·Neon DB의 설정과 초대코드/기록/백업 절차는 [Beta 운영 문서](docs/beta-launch.md)를 따릅니다. `Dockerfile.server`, `render.yaml`, `apps/web/vercel.json`이 배포 구성을 제공합니다.

로컬용 `Dockerfile`과 `compose.yaml`도 제공합니다. `.env`에 `POSTGRES_PASSWORD`, 난수 `REALTIME_SECRET`, `WEB_ORIGIN=http://localhost:3000`을 설정한 뒤 `docker compose up --build`로 실행합니다. Compose는 로컬 개발용으로 Beta 제한을 끕니다. Production 설정은 별도의 Beta 운영 문서를 따릅니다. Production API Session Cookie는 Secure·HttpOnly·SameSite=Strict를 사용합니다. `/v1` 응답을 CDN/Proxy에 Cache하지 마세요.

Recovery Key/초대 Secret/Private Key를 Source나 로그에 기록하지 않습니다. Invite Secret은 URL Fragment로 전달하고 수락 전에 주소에서 제거합니다. Export에는 인증 Secret과 권한을 포함하지 않으며 Import는 새로운 Workspace 소유권을 만듭니다.

## 문서

[제품 문서](docs/product/00-product-vision.md), [기술 구조](docs/product/14-technical-architecture.md), [데이터 모델](docs/product/15-data-model.md), [API 계약](docs/api.md), [Decision Log](docs/product/19-decision-log.md), [Beta 검증 결과](docs/beta-validation.md)를 참고하세요.
