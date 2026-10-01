# 보안 모델

Status: Accepted Alpha specification

## 공격자와 보호 대상

외부 공격자: Token Guessing, Brute Force, CSRF, Replay. 초대 링크 보유자: 먼저 수락하거나 링크 재전달. 악성 협업자: 허용되지 않은 Role/Presence 위조, 문서 오염. 탈취 기기: 저장된 Key와 Local 데이터 접근. 서버 운영자는 Alpha의 신뢰 경계 안이며 평문 문서를 처리할 수 있다.

보호 대상: Workspace 소유권, Private Page, Device Private Key, Recovery/Invite Secret, Local 미전송 데이터.

Device P-256 Private Key는 non-extractable CryptoKey로 IndexedDB에 보관한다. Challenge는 난수·짧은 만료·일회 사용을 적용한다. 세션은 난수 Token Hash를 서버에 저장하고 Secure/HttpOnly/SameSite Cookie를 사용한다. Production은 HTTPS를 요구한다.

Recovery/Invite Key는 256-bit 난수이며 SHA-256 Hash만 저장한다. Secret은 API 응답·요청 body에서 필요한 순간에만 사용하며 Logger에 body를 남기지 않는다. Referrer Policy no-referrer, private 화면 noindex, Fragment Secret 처리 후 URL에서 제거한다.

REST/WS Origin 확인, Rate Limit, Role 검증, WebSocket 메시지/문서 크기 제한, 악성 URL/Paste 차단을 적용한다. Editor가 받은 문서라도 권한·기기 관리 Entity는 수정할 수 없다.

Workspace 삭제는 Owner의 Online 작업이며 명시적 확인을 요구한다. Key 분실과 모든 승인 기기 분실이 함께 일어나면 자동 소유권 복구를 제공하지 않는다. 서버가 가지고 있다는 이유로 이메일 없는 소유권을 임의 확인하지 않는다.

테스트: Replay, Role 우회, Token Scope, Invite Race, Revocation, 키/Token 로그 누출, 악성 입력, DB 실패 시 Ack 부재.
