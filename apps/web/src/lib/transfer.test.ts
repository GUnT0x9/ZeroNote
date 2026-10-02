import { it, expect, vi, afterEach } from "vitest";
import { strToU8, zipSync } from "fflate";
import {
  readTransferFile,
  loadExportFont,
  loadExportFontCss,
} from "./transfer";
import { encryptWorkspaceExport } from "./encrypted-export";
import type { WorkspaceExport } from "@zeronote/shared";
afterEach(() => {
  vi.unstubAllGlobals();
});
it("embeds the export font together with its redistribution license", async () => {
  const fetcher = vi.fn(async (url: string) =>
    url.endsWith(".txt")
      ? new Response("Font Copyright\nOFL-1.1")
      : new Response(new Uint8Array([1, 2])),
  );
  vi.stubGlobal("fetch", fetcher);
  const css = await loadExportFontCss();
  expect(css).toContain("Font Copyright");
  expect(css).toContain("data:font/ttf;base64,AQI=");
  fetcher.mockImplementation(async (url: string) =>
    url.endsWith(".txt")
      ? new Response(null, { status: 503 })
      : new Response(new Uint8Array([1, 2])),
  );
  await expect(loadExportFontCss()).rejects.toThrow("License");
});
function file(name: string, bytes: Uint8Array) {
  return {
    name,
    size: bytes.length,
    arrayBuffer: async () => Uint8Array.from(bytes).buffer,
  };
}
it("reads JSON, encrypted JSON, Markdown and ZIP before importing any Workspace", async () => {
  const workspace: WorkspaceExport = {
    schemaVersion: 1,
    name: "Portable",
    exportedAt: "now",
    pages: [],
  };
  expect(
    (
      await readTransferFile(
        file("backup.json", strToU8(JSON.stringify(workspace))),
        "",
      )
    ).workspace,
  ).toEqual(workspace);
  const encrypted = await encryptWorkspaceExport(
    workspace,
    "correct horse battery",
  );
  expect(
    (
      await readTransferFile(
        file("encrypted.json", strToU8(JSON.stringify(encrypted))),
        "correct horse battery",
      )
    ).workspace,
  ).toEqual(workspace);
  const imported = await readTransferFile(
    file("note.md", strToU8("# Heading\n\nBody")),
    "",
  );
  expect(imported.workspace.pages).toHaveLength(1);
  const archive = await readTransferFile(
    file("vault.zip", zipSync({ "note.md": strToU8("body") })),
    "",
  );
  expect(archive.workspace.pages[0]?.title).toBe("note");
});
it("rejects invalid files before reading and reports font network errors", async () => {
  const read = vi.fn();
  await expect(
    readTransferFile(
      { name: "large.zip", size: 50 * 1024 * 1024 + 1, arrayBuffer: read },
      "",
    ),
  ).rejects.toThrow("50MiB");
  expect(read).not.toHaveBeenCalled();
  await expect(
    readTransferFile(file("bad.json", strToU8("{bad")), ""),
  ).rejects.toThrow();
  const fetcher = vi.fn(async () => new Response(new Uint8Array([1, 2])));
  vi.stubGlobal("fetch", fetcher);
  expect(await loadExportFont()).toEqual(Uint8Array.from([1, 2]));
  fetcher.mockResolvedValueOnce(new Response(null, { status: 503 }));
  await expect(loadExportFont()).rejects.toThrow("글꼴");
});
