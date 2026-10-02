export const COMMANDS = [
  {
    id: "page:open",
    label: "Page로 이동",
    aliases: "open go navigation 이동",
    requires: "workspace",
  },
  {
    id: "page:create",
    label: "새 Page 만들기",
    aliases: "new page document 문서 생성",
    requires: "create",
  },
  {
    id: "database:create",
    label: "일반 Database 만들기",
    aliases: "new database 데이터베이스 생성",
    requires: "create",
  },
  {
    id: "task:create",
    label: "To-Do 만들기",
    aliases: "new task project 프로젝트 생성",
    requires: "create",
  },
  {
    id: "theme:light",
    label: "Light Theme",
    aliases: "light 밝은 테마 화면",
    requires: "none",
  },
  {
    id: "theme:dark",
    label: "Dark Theme",
    aliases: "dark 어두운 테마 화면",
    requires: "none",
  },
  {
    id: "theme:system",
    label: "System Theme",
    aliases: "system 시스템 테마 화면",
    requires: "none",
  },
  {
    id: "capture:open",
    label: "Quick Capture 열기",
    aliases: "capture 빠른 메모 기록",
    requires: "workspace",
  },
  {
    id: "inbox:open",
    label: "Inbox 열기",
    aliases: "inbox 받은 메모 이동",
    requires: "inbox",
  },
  {
    id: "settings:open",
    label: "Settings 열기",
    aliases: "settings 설정 이동",
    requires: "none",
  },
  {
    id: "sync:run",
    label: "지금 동기화",
    aliases: "sync 저장 동기화",
    requires: "online",
  },
] as const;
export type WorkspaceCommand = (typeof COMMANDS)[number];
export interface CommandContext {
  canCreate: boolean;
  hasWorkspace: boolean;
  hasInbox: boolean;
  online: boolean;
}
export function filterWorkspaceCommands(
  query: string,
  context: CommandContext,
  recent: string[] = [],
): WorkspaceCommand[] {
  const text = query.replace(/^>/, "").normalize("NFKC").trim().toLowerCase();
  const enabled = {
    none: true,
    create: context.canCreate,
    workspace: context.hasWorkspace,
    inbox: context.hasInbox,
    online: context.online,
  };
  return COMMANDS.filter(
    (command) =>
      enabled[command.requires] &&
      `${command.label} ${command.aliases}`
        .normalize("NFKC")
        .toLowerCase()
        .includes(text),
  ).sort((a, b) => {
    const left = recent.indexOf(a.id),
      right = recent.indexOf(b.id);
    return (
      (left < 0 ? recent.length : left) - (right < 0 ? recent.length : right)
    );
  });
}
export function recordRecentCommand(
  recent: string[],
  id: WorkspaceCommand["id"],
): string[] {
  const known = new Set<string>(COMMANDS.map((command) => command.id));
  return [
    id,
    ...recent.filter((entry) => entry !== id && known.has(entry)),
  ].slice(0, 8);
}
export function parseCommandNavigation(query: string): string | null {
  const match = /^>\s*(?:open|go|이동)\s+(.*)$/i.exec(query);
  return match ? match[1]!.trim() : null;
}
