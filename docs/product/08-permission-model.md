# Capability와 권한

Status: Accepted Alpha specification

Owner는 Workspace 관리, Recovery Key 회전, 기기 철회, 모든 Page 관리가 가능하다. Page Grant Role은 Editor, Commenter, Viewer다. Editor는 문서/Task/구조 변경과 Comments, Commenter는 Comments와 읽기, Viewer는 읽기만 가능하다.

기본 Grant는 선택한 Page 한정이다. includeDescendants 기본 false이며 명시적으로 켠 경우 현재 Page Tree의 자손에 적용한다. Task Database Row는 같은 권한 경계다. 권한 없는 부모나 형제의 Metadata를 내려주지 않는다.

Invite: 256-bit 난수 Secret, Hash 서버 저장, 기본 7일 만료, 1회 사용. URL Fragment에 Secret을 넣어 서버 URL 로그에서 분리한다. 수락은 DB Transaction으로 단 한 Identity에 Grant한다. 같은 기기의 네트워크 재시도는 같은 결과로 처리한다.

Invite 취소는 아직 수락되지 않은 초대를 막는다. Grant 철회는 이미 수락한 사람의 접근을 종료한다. REST와 WebSocket에서 매번 서버 권한을 검증하고 활성 연결도 종료한다.

Workspace Recovery Key는 Owner 권한을 복구하는 별도 Secret이다. Page 초대 수단으로 사용하지 않는다. 표시 이름은 실명 인증을 의미하지 않는다. 철회는 미래 접근 통제이며 받은 사본 회수를 보장하지 않는다.
