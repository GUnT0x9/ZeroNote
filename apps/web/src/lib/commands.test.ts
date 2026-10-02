import { it, expect } from "vitest";
import {
  filterWorkspaceCommands,
  recordRecentCommand,
  parseCommandNavigation,
} from "./commands";
const context = {
  canCreate: true,
  hasWorkspace: true,
  hasInbox: true,
  online: true,
};
it("parses page navigation without turning ordinary search into commands", () => {
  expect(parseCommandNavigation(">open 문서 이름")).toBe("문서 이름");
  expect(parseCommandNavigation("> 이동 시작하기")).toBe("시작하기");
  expect(parseCommandNavigation(">open ")).toBe("");
  expect(parseCommandNavigation("open page")).toBeNull();
  expect(parseCommandNavigation(">open")).toBeNull();
});
it("finds commands by Korean and English and moves recent commands first", () => {
  expect(
    filterWorkspaceCommands("> dark", context).map((command) => command.id),
  ).toEqual(["theme:dark"]);
  expect(
    filterWorkspaceCommands(">문서", context).map((command) => command.id),
  ).toEqual(["page:create"]);
  expect(filterWorkspaceCommands(">", context, ["theme:dark"])[0]?.id).toBe(
    "theme:dark",
  );
  expect(filterWorkspaceCommands("unknown", context)).toEqual([]);
});
it("removes creation/workspace/online commands when unavailable", () => {
  const items = filterWorkspaceCommands(">", {
    canCreate: false,
    hasWorkspace: false,
    hasInbox: false,
    online: false,
  });
  expect(items.map((command) => command.id)).toEqual([
    "theme:light",
    "theme:dark",
    "theme:system",
    "settings:open",
  ]);
});
it("deduplicates, bounds and sanitizes command history", () => {
  expect(
    recordRecentCommand(["theme:dark", "bad", "theme:light"], "theme:dark"),
  ).toEqual(["theme:dark", "theme:light"]);
  const recent = [
    "page:create",
    "database:create",
    "task:create",
    "theme:light",
    "theme:dark",
    "theme:system",
    "capture:open",
    "settings:open",
  ];
  expect(recordRecentCommand(recent, "sync:run")).toHaveLength(8);
  expect(recordRecentCommand([], "page:create")).toEqual(["page:create"]);
});
