# Editor 명세

Status: Accepted Alpha specification

Tiptap 3/ProseMirror와 Yjs Collaboration을 사용한다. 기본 UndoRedo는 끄고 공동 편집 UndoManager를 사용한다. Editor는 Local Persistence hydration이 끝난 뒤 표시한다.

Text, Heading 1–3, Bullet/Numbered, Todo, Toggle, Quote, Callout, Divider, Code, Page Mention을 지원한다. Slash Popup은 Arrow Up/Down으로 선택하고 Enter로 실행, Escape로 닫는다. Markdown Heading/List/Quote/Code/Todo 변환은 Tiptap Input Rule을 사용한다.

Block Control은 Hover와 Focus에서 노출한다. Todo 변환은 선택한 Todo 내용을 Task Database Row로 복사한 뒤 Task Link로 대체한다. 변환 실패 시 원문을 유지한다.

Page Mention은 pageId만 저장하고 접근 가능한 Metadata에서 제목을 구한다. 제목 변경은 링크를 끊지 않는다. 접근 권한이 없으면 접근 제한 문구를 표시한다. [[ 입력 후 제목 검색 또는 Page Link 메뉴로 삽입한다.

Code Block은 언어 선택·강조를 제공하되 실행하지 않는다. Paste의 지원하지 않는 Node/Attribute와 javascript: URL을 허용하지 않는다. Markdown 원문 편집 및 .md Import는 후속 기능이다.

검증: Slash Keyboard, Markdown 변환, 모든 Block, Mention Rename, 두 기기 편집, 타인 변경을 되돌리지 않는 Undo, 빈 문서 및 악성 Paste.

## Block 계약

| Node             | 입력/Trigger                           | Behavior                       | Offline/Sync              | Error                         | Acceptance Criteria            |
| ---------------- | -------------------------------------- | ------------------------------ | ------------------------- | ----------------------------- | ------------------------------ |
| Text/Heading 1–3 | 일반 입력/`#`·`##`·`###` + Space/Slash | 텍스트·구조 수준 변경          | 같은 Fragment CRDT        | 빈 Block 허용                 | 제목 수준·본문 내용 유지       |
| Bullet/Numbered  | Markdown List/Slash                    | List Item 추가·중첩            | 문서 CRDT                 | 지원하지 않는 Paste Node 제거 | Enter로 다음 Item 작성         |
| Todo             | Checkbox Shortcut/Slash                | checked 상태와 문장            | 문서 CRDT                 | Task 생성 실패 시 Todo 유지   | 체크·Undo·Task Link 변환       |
| Toggle           | Slash                                  | Summary와 접히는 Content       | 문서 CRDT                 | 빈 Summary 허용               | 접힘 상태·내부 내용 보존       |
| Quote/Callout    | Markdown Quote/Slash                   | 인용/강조 Container            | 문서 CRDT                 | 지원 Node만 보존              | 내부 텍스트 편집 가능          |
| Divider          | Slash                                  | 구조 구분                      | 문서 CRDT                 | 삭제/Undo 가능                | 앞뒤 Block 내용 유지           |
| Code             | Fenced Shortcut/Slash                  | 언어 선택·Highlight            | 원문 CRDT                 | 모르는 언어는 Plain Text      | 코드 실행 없이 원문 유지       |
| Page Mention     | `[[` 선택                              | ID로 연결·실시간 Rename 표시   | Node ID 병합              | 권한 없는 대상은 열지 않음    | Rename/Import 재매핑 후 연결   |
| Task Link        | Todo를 Task로 변환                     | Database ID+Row ID로 상세 열기 | 문서와 Database 각각 저장 | Database 권한이 필요          | 원래 위치에서 Task 상세로 이동 |

Editor는 연결 상태 변경만으로 다시 만들지 않는다. Awareness는 문서 세션 동안 유지하고 Editor의 UndoManager는 해당 Fragment의 로컬 편집만 추적한다. Hover/Focus에서 Block 이동·복제·삭제를 제공한다. Slash/`[[` 메뉴는 Arrow·Enter·Escape를 지원하며 Mouse 선택 시 문서 Focus를 유지한다.

Todo 변환은 접근 가능한 Task Database를 사용하며 Owner에게는 기본 프로젝트를 만들 수 있다. 초대된 Editor에게 접근 가능한 프로젝트가 없다면 원문을 유지하고 프로젝트 초대가 필요함을 안내한다.
