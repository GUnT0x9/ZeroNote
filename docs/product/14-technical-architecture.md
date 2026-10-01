# 기술 아키텍처

Status: Accepted Alpha specification

독립 pnpm Workspace: apps/web(Next.js 16/React 19), apps/server(Fastify/Hocuspocus), packages/shared(Zod/Type/Yjs Schema). 상위 프로젝트 package 설정을 수정하지 않는다.

Client 모듈: UI, Editor, Local Repository(Dexie), Document Session(y-indexeddb/Yjs), Search Projection, Sync Engine, Device Crypto. Zustand는 UI 상태에만 사용한다.

Server는 Modular Monolith다. Routes → Services → Repositories → PostgreSQL. Realtime은 같은 Node Process에 두어 권한 철회 이벤트와 연결 Registry를 공유한다. Redis와 Microservice는 Alpha에 도입하지 않는다.

Document 본문은 Yjs, Metadata/권한은 서버 승인 데이터다. REST durable commit과 Realtime은 동일한 Y.Doc에 멱등 update를 적용한다. PostgreSQL 로그와 Checkpoint로 서버 재시작 시 복구한다.

Production은 Next와 API를 동일 Origin으로 Reverse Proxy하며 /v1와 /collaboration을 API에 연결한다. Docker Compose로 Web/API/PostgreSQL을 제공한다. 개발 환경은 Node 24와 로컬 PostgreSQL도 지원한다.

환경변수는 Zod로 검증한다. Logger는 Pino를 사용하고 Secret/본문은 기록하지 않는다. Server-only 모듈을 Client Component에서 Import하지 않는다.
