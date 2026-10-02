import { test, expect, type Page } from "@playwright/test";
import { createBrowserBetaCode } from "./beta-helpers";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  unzipSync,
  strFromU8,
  zipSync,
  strToU8,
} from "../apps/web/node_modules/fflate";
const ORIGIN = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3002";
test("Portable exports download Markdown, safe HTML, ZIP and a Korean PDF that renders", async ({
  page,
}) => {
  const name = `Formats ${Date.now()}`;
  const directory = await mkdtemp(join(tmpdir(), "zeronote-html-export-"));
  try {
    await createWorkspace(page, name);
    await page.getByLabel("Page 제목").fill("한글 문서");
    await page
      .getByRole("textbox", { name: "문서 본문" })
      .fill("한글 첫 줄\nSecond line");
    await page.getByRole("button", { name: "Page 메뉴", exact: true }).click();
    await page.getByRole("button", { name: "Export", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Page Export" });
    const download = async (format: string) => {
      await dialog.getByLabel("Export 형식").selectOption(format);
      const waiting = page.waitForEvent("download");
      await dialog
        .getByRole("button", { name: "내려받기", exact: true })
        .click();
      const file = await waiting,
        path = await file.path();
      if (!path) throw new Error("Missing export file");
      await expect(
        dialog.getByRole("button", { name: "내려받기", exact: true }),
      ).toBeEnabled();
      return { file, data: await readFile(path) };
    };
    const markdown = await download("markdown");
    expect(markdown.file.suggestedFilename()).toMatch(/\.md$/);
    expect(markdown.data.toString()).toContain("한글 첫 줄");
    const html = await download("html");
    expect(html.file.suggestedFilename()).toMatch(/\.html$/);
    expect(html.data.toString()).toContain("<html");
    expect(html.data.toString()).toContain("font-family:Pretendard");
    expect(html.data.toString()).not.toContain("zn_session");
    const htmlPath = join(directory, "export.html");
    await writeFile(htmlPath, html.data);
    const preview = await page.context().newPage();
    try {
      await preview.goto(pathToFileURL(htmlPath).href);
      await expect(preview.getByRole("heading", { level: 1 })).toHaveText(
        "한글 문서",
      );
      await preview.evaluate(() => document.fonts.ready);
      expect(
        await preview.evaluate(() =>
          [...document.fonts].some(
            (font) => font.family === "Pretendard" && font.status === "loaded",
          ),
        ),
      ).toBe(true);
    } finally {
      await preview.close();
    }
    const archive = await download("zip"),
      files = unzipSync(archive.data);
    expect(files["zeronote.json"]).toBeDefined();
    expect(strFromU8(files["zeronote.json"]!)).not.toContain("recoveryHash");
    const pdf = await download("pdf");
    expect(pdf.file.suggestedFilename()).toMatch(/\.pdf$/);
    expect(pdf.data.subarray(0, 5).toString()).toBe("%PDF-");
    await page.context().setOffline(true);
    const offlinePdf = await download("pdf");
    expect(offlinePdf.data.subarray(0, 5).toString()).toBe("%PDF-");
    await page.context().setOffline(false);
    await dialog.getByRole("button", { name: "닫기", exact: true }).click();
    await page.getByLabel("첨부 파일 선택").setInputFiles({
      name: "exported.pdf",
      mimeType: "application/pdf",
      buffer: pdf.data,
    });
    await page.getByText("PDF 미리보기", { exact: true }).click();
    await expect(page.locator(".pdf-pages")).toHaveAttribute(
      "aria-busy",
      "false",
    );
    await expect(page.locator(".pdf-pages")).toContainText("한글 문서");
    await expect(page.locator(".pdf-pages")).toContainText("한글 첫 줄");
    await expect(page.locator(".pdf-pages").getByRole("alert")).toHaveCount(0);
  } finally {
    await page.context().setOffline(false);
    await cleanup(page, name);
    await rm(directory, { recursive: true, force: true });
  }
});
test("Notion Markdown CSV and Obsidian links import into usable Pages and Database row bodies", async ({
  page,
}) => {
  const name = `Interop ${Date.now()}`;
  let originalId: string | null = null,
    importedId: string | null = null;
  try {
    await createWorkspace(page, name);
    originalId = new URL(page.url()).searchParams.get("workspace");
    const archive = zipSync({
      "Home aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.md": strToU8(
        "# Home\n\n[[Note|Read this]]",
      ),
      "Note.md": strToU8("# Note\n\nBody from Obsidian"),
      "Tasks.csv": strToU8("Name,Status\nShip,Done"),
      "Tasks/Ship bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.md": strToU8(
        "# Ship\n\nImported row details",
      ),
    });
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page
      .getByRole("button", { name: "데이터 이전", exact: true })
      .click();
    const dialog = page.getByRole("dialog", { name: "데이터 이전" });
    await dialog.getByLabel("가져올 데이터 파일").setInputFiles({
      name: `${name}.zip`,
      mimeType: "application/zip",
      buffer: Buffer.from(archive),
    });
    await dialog
      .getByRole("button", { name: "새 Workspace로 가져오기", exact: true })
      .click();
    await expect(page.getByTestId("recovery-key")).toBeVisible();
    await page.getByRole("button", { name: "계속하기", exact: true }).click();
    await expect(page.getByLabel("Page 제목")).toHaveValue("Home");
    const editor = page.getByRole("textbox", { name: "문서 본문" });
    await editor.getByRole("button", { name: "Note", exact: true }).click();
    await expect(page.getByLabel("Page 제목")).toHaveValue("Note");
    await expect(editor).toContainText("Body from Obsidian");
    await page.getByRole("button", { name: "Tasks", exact: true }).click();
    await expect(page.getByLabel("항목 이름")).toHaveValue("Ship");
    await page.getByRole("button", { name: "Ship 열기", exact: true }).click();
    await expect(page.getByLabel("Page 제목")).toHaveValue("Ship");
    await expect(editor).toContainText("Imported row details");
    await expect(
      page.getByRole("button", { name: "서버 동기화 완료", exact: true }),
    ).toBeVisible();
    importedId = new URL(page.url()).searchParams.get("workspace");
  } finally {
    for (const [id, workspaceName] of [
      [originalId, name],
      [importedId, `${name} (가져옴)`],
    ])
      if (id)
        await page.request.delete(`${ORIGIN}/v1/workspaces/${id}`, {
          headers: { origin: ORIGIN },
          data: { name: workspaceName },
        });
  }
});
test("Encrypted Workspace backup rejects a wrong password and restores documents with a fresh Recovery Key", async ({
  page,
}) => {
  const name = `Encrypted ${Date.now()}`,
    password = "correct horse battery staple";
  let originalId: string | null = null,
    importedId: string | null = null;
  try {
    await createWorkspace(page, name);
    originalId = new URL(page.url()).searchParams.get("workspace");
    await page.getByLabel("Page 제목").fill("Secret knowledge");
    await page
      .getByRole("textbox", { name: "문서 본문" })
      .fill("Keep this text through encryption.");
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page
      .getByRole("button", { name: "데이터 이전", exact: true })
      .click();
    const dialog = page.getByRole("dialog", { name: "데이터 이전" });
    await dialog.getByLabel("Export 형식").selectOption("encrypted");
    await dialog.getByLabel("백업 암호", { exact: true }).fill(password);
    await dialog.getByLabel("백업 암호 확인").fill(password);
    await dialog.getByLabel("백업 암호 확인").fill("a different confirmation");
    await dialog.getByRole("button", { name: "내려받기", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText(
      "확인 암호가 일치하지",
    );
    await dialog.getByLabel("백업 암호 확인").fill(password);
    const waiting = page.waitForEvent("download");
    await dialog.getByRole("button", { name: "내려받기", exact: true }).click();
    const saved = await waiting,
      path = await saved.path();
    if (!path) throw new Error("Missing encrypted backup");
    const bytes = await readFile(path);
    expect(bytes.toString()).not.toContain("Secret knowledge");
    expect(bytes.toString()).not.toContain(password);
    await dialog.getByLabel("Import 백업 암호").fill("wrong password value");
    await dialog.getByLabel("가져올 데이터 파일").setInputFiles(path);
    await expect(dialog.getByRole("alert")).toContainText("암호가 다르거나");
    await expect(
      dialog.getByRole("button", {
        name: "새 Workspace로 가져오기",
        exact: true,
      }),
    ).toHaveCount(0);
    await dialog.getByLabel("Import 백업 암호").fill(password);
    await dialog.getByLabel("가져올 데이터 파일").setInputFiles(path);
    await dialog
      .getByRole("button", { name: "새 Workspace로 가져오기", exact: true })
      .click();
    await expect(page.getByTestId("recovery-key")).toBeVisible();
    await page.getByRole("button", { name: "계속하기", exact: true }).click();
    importedId = new URL(page.url()).searchParams.get("workspace");
    expect(importedId).not.toBe(originalId);
    await expect(page.getByLabel("Page 제목")).toHaveValue("Secret knowledge");
    await expect(
      page.getByRole("textbox", { name: "문서 본문" }),
    ).toContainText("Keep this text through encryption.");
    await expect(
      page.getByRole("button", { name: "서버 동기화 완료", exact: true }),
    ).toBeVisible();
  } finally {
    for (const [id, workspaceName] of [
      [originalId, name],
      [importedId, `${name} (가져옴)`],
    ])
      if (id)
        await page.request.delete(`${ORIGIN}/v1/workspaces/${id}`, {
          headers: { origin: ORIGIN },
          data: { name: workspaceName },
        });
  }
});
test("Media attachments render Audio, Video and bounded PDF pages without losing bytes", async ({
  page,
}) => {
  const name = `Media ${Date.now()}`;
  try {
    await createWorkspace(page, name);
    await page
      .getByLabel("첨부 파일 선택")
      .setInputFiles("tests/fixtures/silence.wav");
    const audio = page.getByLabel("silence.wav", { exact: true });
    await expect(audio).toBeVisible();
    await expect
      .poll(() =>
        audio.evaluate((element) => (element as HTMLAudioElement).duration),
      )
      .toBeGreaterThan(0);
    const video = await page.evaluate(async () => {
      const canvas = document.createElement("canvas");
      canvas.width = 24;
      canvas.height = 24;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Missing canvas context");
      context.fillRect(0, 0, 24, 24);
      const stream = canvas.captureStream(10),
        recorder = new MediaRecorder(stream, { mimeType: "video/webm" }),
        chunks: Blob[] = [];
      return new Promise<number[]>((resolve, reject) => {
        recorder.ondataavailable = (event) => chunks.push(event.data);
        recorder.onerror = () => reject(new Error("Recording failed"));
        recorder.onstop = () => {
          for (const track of stream.getTracks()) track.stop();
          void new Blob(chunks)
            .arrayBuffer()
            .then((buffer) => resolve([...new Uint8Array(buffer)]))
            .catch(reject);
        };
        recorder.start();
        setTimeout(() => {
          context.fillStyle = "white";
          context.fillRect(0, 0, 24, 24);
          recorder.stop();
        }, 500);
      });
    });
    await page.getByLabel("첨부 파일 선택").setInputFiles({
      name: "clip.webm",
      mimeType: "video/webm",
      buffer: Buffer.from(video),
    });
    const clip = page.getByLabel("clip.webm", { exact: true });
    await expect(clip).toBeVisible();
    await expect
      .poll(() =>
        clip.evaluate((element) => (element as HTMLVideoElement).videoWidth),
      )
      .toBe(24);
    await page
      .getByLabel("첨부 파일 선택")
      .setInputFiles("tests/fixtures/sample.pdf");
    await page.getByText("PDF 미리보기", { exact: true }).click();
    const preview = page.locator(".pdf-pages");
    await expect(preview).toHaveAttribute("aria-busy", "false");
    await expect(preview).toContainText("ZeroNote PDF fixture");
    await expect(
      preview.getByRole("img", { name: "sample.pdf · Page 1", exact: true }),
    ).toBeVisible();
    await expect(
      preview.getByRole("button", { name: "다음 Page", exact: true }),
    ).toBeDisabled();
    await expect(preview.getByRole("alert")).toHaveCount(0);
    await page.getByText("PDF 미리보기", { exact: true }).click();
    await page.getByLabel("첨부 파일 선택").setInputFiles({
      name: "corrupt.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4 invalid bytes"),
    });
    await page.getByText("PDF 미리보기", { exact: true }).last().click();
    await expect(page.locator(".pdf-pages").getByRole("alert")).toBeVisible();
    await expect(
      page.getByRole("link", { name: "corrupt.pdf 다운로드", exact: true }),
    ).toBeVisible();
  } finally {
    await cleanup(page, name);
  }
});
test("Attachment upload, image preview, Offline reload, Viewer access and Snapshot copy", async ({
  page,
  browser,
}) => {
  const name = `Files ${Date.now()}`;
  const viewerContext = await browser.newContext(),
    viewer = await viewerContext.newPage();
  try {
    await createWorkspace(page, name);
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5WQAAAAASUVORK5CYII=",
      "base64",
    );
    await page.getByLabel("첨부 파일 선택").setInputFiles({
      name: "sample.png",
      mimeType: "image/png",
      buffer: png,
    });
    const image = page.getByAltText("sample.png", { exact: true });
    await expect(image).toBeVisible();
    await expect
      .poll(() =>
        image.evaluate((element) => (element as HTMLImageElement).naturalWidth),
      )
      .toBe(1);
    await expect(page.locator(".attachment-caption small")).toContainText(
      "서버 저장됨",
    );
    await expect(
      page.getByRole("button", { name: "서버 동기화 완료", exact: true }),
    ).toBeVisible();
    await page.context().setOffline(true);
    await page.reload();
    await expect(
      page.getByAltText("sample.png", { exact: true }),
    ).toBeVisible();
    await expect
      .poll(() =>
        page
          .getByAltText("sample.png", { exact: true })
          .evaluate((element) => (element as HTMLImageElement).naturalWidth),
      )
      .toBe(1);
    await page.getByLabel("첨부 파일 선택").setInputFiles({
      name: "offline.ts",
      mimeType: "text/plain",
      buffer: Buffer.from("const offline = true;"),
    });
    await expect(page.getByText("offline.ts", { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByText("offline.ts", { exact: true })).toBeVisible();
    await page.context().setOffline(false);
    await page
      .getByRole("button", { name: "서버 동기화 완료", exact: true })
      .waitFor();
    await page
      .getByRole("textbox", { name: "문서 본문" })
      .evaluate((element) => {
        const transfer = new DataTransfer();
        transfer.items.add(
          new File(["pasted bytes"], "pasted.txt", { type: "text/plain" }),
        );
        element.dispatchEvent(
          new ClipboardEvent("paste", {
            bubbles: true,
            cancelable: true,
            clipboardData: transfer,
          }),
        );
      });
    await expect(page.getByText("pasted.txt", { exact: true })).toBeVisible();
    await page
      .getByRole("textbox", { name: "문서 본문" })
      .evaluate((element) => {
        const transfer = new DataTransfer();
        transfer.items.add(
          new File(["dropped bytes"], "dropped.txt", { type: "text/plain" }),
        );
        const rect = element.getBoundingClientRect();
        element.dispatchEvent(
          new DragEvent("drop", {
            bubbles: true,
            cancelable: true,
            dataTransfer: transfer,
            clientX: rect.left + 12,
            clientY: rect.top + 12,
          }),
        );
      });
    await expect(page.getByText("dropped.txt", { exact: true })).toBeVisible();
    await viewer.goto(await createInvite(page, "viewer"));
    await expect(
      viewer.getByAltText("sample.png", { exact: true }),
    ).toBeVisible();
    await expect
      .poll(() =>
        viewer
          .getByAltText("sample.png", { exact: true })
          .evaluate((element) => (element as HTMLImageElement).naturalWidth),
      )
      .toBe(1);
    await expect(
      viewer.getByRole("button", { name: "파일 첨부", exact: true }),
    ).toHaveCount(0);
    await openPageTool(page, "기록");
    const panel = page.getByRole("complementary", { name: "기록" });
    await panel.getByLabel("기록 이름").fill("With attachments");
    await panel.getByRole("button", { name: "현재 상태 기록하기" }).click();
    await panel.getByRole("button", { name: /With attachments/ }).click();
    await expect(
      panel.getByAltText("sample.png", { exact: true }),
    ).toBeVisible();
    await panel.getByRole("button", { name: "새 Page로 복구" }).click();
    await expect(panel).toHaveCount(0);
    await expect(page.getByLabel("Page 제목")).toHaveValue(/^시작하기 \(복구/);
    await expect(
      page.getByAltText("sample.png", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("offline.ts", { exact: true })).toBeVisible();
  } finally {
    await viewerContext.close();
    await cleanup(page, name);
  }
});
test("Command Palette creates and navigates Pages, saves themes and reuses Templates", async ({
  page,
}) => {
  const name = `Commands templates ${Date.now()}`;
  try {
    await createWorkspace(page, name);
    await page.keyboard.press("Control+k");
    await page.getByLabel("Workspace 검색").fill(">dark");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.keyboard.press("Control+k");
    await page.getByLabel("Workspace 검색").fill(">문서");
    await page.keyboard.press("Enter");
    await expect(page.getByLabel("Page 제목")).toHaveValue("제목 없음");
    await page.getByLabel("Page 제목").fill("Command document");
    await page
      .getByRole("textbox", { name: "문서 본문" })
      .fill("Original document body");
    await page.getByRole("button", { name: "Page 메뉴", exact: true }).click();
    await page
      .getByRole("button", { name: "Template으로 새 Page", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: /^회의록/ })
      .click();
    await expect(page.getByLabel("Page 제목")).toHaveValue("회의록");
    await expect(
      page.getByRole("heading", { name: "참석자", level: 2 }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Page 메뉴", exact: true }).click();
    await page
      .getByRole("button", { name: "Template으로 지정", exact: true })
      .click();
    const original = new URL(page.url()).searchParams.get("page");
    await page.getByRole("button", { name: "Page 메뉴", exact: true }).click();
    await page
      .getByRole("button", { name: "Template으로 새 Page", exact: true })
      .click();
    await expect(
      page
        .getByRole("dialog")
        .getByRole("button", { name: "회의록", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "회의록", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect
      .poll(() => new URL(page.url()).searchParams.get("page"))
      .not.toBe(original);
    await expect(
      page.getByRole("heading", { name: "참석자", level: 2 }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Page 메뉴", exact: true }).click();
    await page.getByRole("button", { name: "Page 복제", exact: true }).click();
    await expect(page.getByLabel("Page 제목")).toHaveValue("회의록 (복사)");
    await expect(
      page.getByRole("heading", { name: "참석자", level: 2 }),
    ).toBeVisible();
    await page.keyboard.press("Control+k");
    await page.getByLabel("Workspace 검색").fill(">open Command document");
    await page.keyboard.press("Enter");
    await expect(page.getByLabel("Page 제목")).toHaveValue("Command document");
    await expect(
      page.getByRole("textbox", { name: "문서 본문" }),
    ).toContainText("Original document body");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.keyboard.press("Control+k");
    await page.getByLabel("Workspace 검색").fill(">");
    await expect(
      page
        .getByRole("dialog")
        .getByRole("button", { name: "Page로 이동", exact: true }),
    ).toHaveClass(/selected/);
  } finally {
    await cleanup(page, name);
  }
});
async function createWorkspace(
  page: Page,
  name = "Browser workspace",
): Promise<string> {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Workspace 만들기", exact: true })
    .first()
    .click();
  await page.getByLabel("Workspace 이름").fill(name);
  await page.getByLabel("Beta 초대코드").fill(await createBrowserBetaCode());
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Workspace 만들기", exact: true })
    .click();
  await expect(page.getByTestId("recovery-key")).toBeVisible();
  const key = await page.getByTestId("recovery-key").innerText();
  await page.getByRole("button", { name: "계속하기", exact: true }).click();
  await expect(page.getByLabel("Page 제목")).toHaveValue("시작하기");
  await expect(
    page.getByRole("button", { name: "서버 동기화 완료", exact: true }),
  ).toBeVisible();
  if (ORIGIN.startsWith("https://")) {
    const session = (await page.context().cookies()).find(
      (cookie) => cookie.name === "zn_session",
    );
    expect(session).toMatchObject({
      domain: new URL(ORIGIN).hostname,
      httpOnly: true,
      secure: true,
      sameSite: "Strict",
    });
  }
  return key;
}
async function openPageTool(
  page: Page,
  name: "Comments" | "Properties" | "Backlinks" | "기록",
): Promise<void> {
  const action = page.getByRole("button", { name, exact: true });
  if (!(await action.isVisible()))
    await page.getByRole("button", { name: "Page 메뉴", exact: true }).click();
  await action.click();
}
async function openWorkspaceTool(
  page: Page,
  name: "Quick Capture" | "Inbox",
): Promise<void> {
  await page
    .getByRole("button", { name: "Workspace 전환", exact: true })
    .click();
  await page.getByRole("button", { name, exact: true }).click();
}
async function createInvite(page: Page, role = "editor"): Promise<string> {
  await page.getByRole("button", { name: "Share", exact: true }).click();
  const panel = page.getByRole("complementary", { name: "Share" });
  await panel.getByRole("combobox").selectOption(role);
  await panel.getByRole("button", { name: "초대 링크 만들기" }).click();
  await expect(panel.getByLabel("초대 링크")).toBeVisible();
  return panel.getByLabel("초대 링크").inputValue();
}
async function cleanup(page: Page, name: string): Promise<void> {
  try {
    const workspace = new URL(page.url()).searchParams.get("workspace");
    if (workspace)
      await page.request.delete(`${ORIGIN}/v1/workspaces/${workspace}`, {
        headers: { origin: ORIGIN },
        data: { name },
      });
  } catch {
    /* Context cleanup still releases local state. */
  }
}

test("Markdown, Task Table/Board and mobile-safe quick capture", async ({
  page,
}) => {
  const name = `Flows ${Date.now()}`;
  await createWorkspace(page, name);
  await page.getByLabel("Page 제목").fill("Engineering notes");
  const editor = page.getByRole("textbox", { name: "문서 본문" });
  await editor.fill("");
  await editor.pressSequentially("# Architecture ");
  await expect(editor.locator("h1")).toContainText("Architecture");
  await editor.press("Control+End");
  await editor.evaluate((element) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData(
      "text/html",
      '<p onclick="window.__zeroNotePasteRan=true">Safe paste <a href="javascript:window.__zeroNotePasteRan=true">unsafe link</a> <a href="https://example.com/">valid link</a><img src="invalid" onerror="window.__zeroNotePasteRan=true"><script>window.__zeroNotePasteRan=true</script></p>',
    );
    element.dispatchEvent(
      new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData,
      }),
    );
  });
  await expect(editor).toContainText("Safe paste");
  await expect(editor.locator('a[href="https://example.com/"]')).toHaveCount(1);
  await expect(
    editor.locator('script, img, [onclick], [onerror], a[href^="javascript:"]'),
  ).toHaveCount(0);
  expect(await page.evaluate(() => "__zeroNotePasteRan" in window)).toBe(false);
  await page.getByRole("button", { name: "To-Do", exact: true }).click();
  await page.getByRole("button", { name: "새 Task", exact: true }).click();
  await page.getByLabel("새 Task 제목").fill("Ship Alpha");
  await page.getByRole("button", { name: "추가", exact: true }).click();
  await expect(page.getByLabel("Task 이름")).toHaveValue("Ship Alpha");
  await page.getByLabel("Ship Alpha Status").selectOption("in_progress");
  await page.getByRole("button", { name: "Board", exact: true }).click();
  await expect(
    page
      .getByRole("region", { name: "In progress" })
      .getByRole("button", { name: "Ship Alpha", exact: true }),
  ).toBeVisible();
  await openWorkspaceTool(page, "Quick Capture");
  await page
    .getByLabel("빠른 메모")
    .fill("Captured thought\nKeep this offline.");
  await page.getByLabel("빠른 메모").press("Control+Enter");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await openWorkspaceTool(page, "Inbox");
  await expect(
    page.getByRole("button", { name: /Captured thought/ }),
  ).toBeVisible();
  await cleanup(page, name);
});

test("Upper-left sync indicator waits for commits without moving the document and supports retry", async ({
  page,
}) => {
  const name = `Sync UI ${Date.now()}`;
  await createWorkspace(page, name);
  const status = page.locator(".sidebar").getByTestId("sync-status");
  const title = page.getByLabel("Page 제목");
  const initialPosition = await title.boundingBox();
  let releaseCommit = () => {};
  let markCommitReceived = () => {};
  const commitGate = new Promise<void>((resolve) => {
    releaseCommit = resolve;
  });
  const commitReceived = new Promise<void>((resolve) => {
    markCommitReceived = resolve;
  });
  const commitRoute = "**/v1/documents/*/commit";
  try {
    await page.route(commitRoute, async (route) => {
      markCommitReceived();
      await commitGate;
      await route.continue();
    });
    await title.fill("Saving without banners");
    await commitReceived;
    await expect(status).toHaveAttribute("data-state", /connecting|saving/);
    await expect(page.locator(".sync-banner")).toHaveCount(0);
    expect((await status.boundingBox())!.x).toBeLessThan(240);
    expect((await title.boundingBox())!.y).toBe(initialPosition!.y);
    expect(
      await status
        .locator("svg")
        .evaluate((icon) => getComputedStyle(icon).animationName),
    ).toBe("spin");
    await page.emulateMedia({ reducedMotion: "reduce" });
    expect(
      await status
        .locator("svg")
        .evaluate((icon) => getComputedStyle(icon).animationName),
    ).toBe("none");
    releaseCommit();
    await expect(status).toHaveAttribute("data-state", "saved");
    await expect(status).toHaveAccessibleName("서버 동기화 완료");
    expect((await title.boundingBox())!.y).toBe(initialPosition!.y);
    await page.unroute(commitRoute);
    await page.route(commitRoute, async (route) => {
      await route.fulfill({
        status: 507,
        contentType: "application/json",
        body: JSON.stringify({ error: "서버 저장 공간을 확인해주세요." }),
      });
    });
    await title.fill("Local edits stay available");
    await expect(status).toHaveAttribute("data-state", "error");
    await expect(title).toHaveValue("Local edits stay available");
    await expect(page.locator(".sync-banner")).toHaveCount(0);
    await status.click();
    const detail = page.getByRole("region", {
      name: "동기화 상태",
      exact: true,
    });
    await expect(detail).toContainText("서버 저장 공간을 확인해주세요.");
    await page.unroute(commitRoute);
    await detail
      .getByRole("button", { name: "다시 시도", exact: true })
      .click();
    await expect(status).toHaveAttribute("data-state", "saved");
    await page.keyboard.press("Escape");
    await expect(detail).toHaveCount(0);
    await expect(status).toBeFocused();
    await status.click();
    await expect(detail).toBeVisible();
    await title.click();
    await expect(detail).toHaveCount(0);
    await page.setViewportSize({ width: 390, height: 844 });
    const mobileStatus = page
      .locator(".mobile-topbar")
      .getByTestId("sync-status");
    await expect(mobileStatus).toBeVisible();
    await expect(
      page.getByRole("complementary", { name: "Workspace 탐색" }),
    ).toHaveCount(0);
    const touchTarget = (await mobileStatus.boundingBox())!;
    expect(touchTarget.width).toBeGreaterThanOrEqual(44);
    expect(touchTarget.height).toBeGreaterThanOrEqual(44);
    expect(touchTarget.x).toBeLessThan(110);
  } finally {
    releaseCommit();
    await page.unrouteAll({ behavior: "wait" });
    await cleanup(page, name);
  }
});

test("Figma main navigation keeps favorites, context actions and Sidebar collapse usable", async ({
  page,
}) => {
  const name = `Navigation ${Date.now()}`;
  await createWorkspace(page, name);
  try {
    await expect(page.getByRole("textbox", { name: "문서 본문" })).toHaveText(
      "",
    );
    await expect(
      page.getByRole("button", { name: "Quick Capture", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Comments", exact: true }),
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: "즐겨찾기 추가", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "즐겨찾기 해제", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText("Favorites", { exact: true })).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole("button", { name: "즐겨찾기 해제", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await page
      .getByRole("button", { name: "즐겨찾기 해제", exact: true })
      .click();
    await expect(page.getByText("Favorites", { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Pages", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "To-Do", exact: true }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "Pages", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "To-Do", exact: true }),
    ).toBeVisible();
    await openPageTool(page, "Comments");
    await expect(
      page.getByRole("complementary", { name: "Comments", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Context Panel 닫기", exact: true })
      .click();
    await page.getByRole("button", { name: "Page 메뉴", exact: true }).click();
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("button", { name: "Page 메뉴", exact: true }),
    ).toHaveAttribute("aria-expanded", "false");
    await page
      .getByRole("button", { name: "Sidebar 닫기", exact: true })
      .click();
    await expect(
      page.getByRole("complementary", { name: "Workspace 탐색" }),
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: "Sidebar 열기", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Workspace 전환", exact: true }),
    ).toBeVisible();
  } finally {
    await cleanup(page, name);
  }
});

test("Page invitation, realtime editing, comments, viewer enforcement and recovery", async ({
  page,
  browser,
}) => {
  const name = `Collaboration ${Date.now()}`,
    key = await createWorkspace(page, name);
  await page.getByLabel("Page 제목").fill("Shared architecture");
  await page
    .getByRole("textbox", { name: "문서 본문" })
    .fill("A shared starting point.");
  await expect(
    page.getByRole("button", { name: "서버 동기화 완료", exact: true }),
  ).toBeVisible();
  const link = await createInvite(page);
  const context = await browser.newContext({
      viewport: { width: 1440, height: 960 },
    }),
    member = await context.newPage();
  await member.goto(link);
  await expect(member.getByLabel("Page 제목")).toHaveValue(
    "Shared architecture",
  );
  await expect(
    member.getByRole("textbox", { name: "문서 본문" }),
  ).toContainText("A shared starting point.");
  await member.getByRole("textbox", { name: "문서 본문" }).click();
  await member.keyboard.press("Control+End");
  await member.keyboard.type(" Shared edit.");
  await expect(page.getByRole("textbox", { name: "문서 본문" })).toContainText(
    "Shared edit.",
  );
  await openPageTool(member, "Comments");
  await member.getByLabel("Comment 내용").fill("Ready for review");
  await member.getByRole("button", { name: "보내기", exact: true }).click();
  await openPageTool(page, "Comments");
  await expect(
    page.getByText("Ready for review", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Share", exact: true }).click();
  const viewerLink = await createInviteFromOpenPanel(page, "viewer");
  const viewerContext = await browser.newContext(),
    viewer = await viewerContext.newPage();
  await viewer.goto(viewerLink);
  await expect(viewer.getByLabel("Page 제목")).toHaveAttribute("readonly", "");
  await expect(
    viewer.getByRole("textbox", { name: "문서 본문" }),
  ).toHaveAttribute("contenteditable", "false");
  const recoveryContext = await browser.newContext(),
    recovered = await recoveryContext.newPage();
  await recovered.goto("/");
  await recovered.getByRole("button", { name: "기존 Workspace 복구" }).click();
  await recovered.getByLabel("Recovery Key", { exact: true }).fill(key);
  await recovered
    .getByRole("dialog")
    .getByRole("button", { name: "Workspace 복구", exact: true })
    .click();
  await expect(recovered.getByLabel("Page 제목")).toHaveValue(
    "Shared architecture",
  );
  await expect(
    recovered.getByRole("textbox", { name: "문서 본문" }),
  ).toContainText("Shared edit.");
  await cleanup(page, name);
  await Promise.all([
    context.close(),
    viewerContext.close(),
    recoveryContext.close(),
  ]);
});
async function createInviteFromOpenPanel(
  page: Page,
  role: string,
): Promise<string> {
  const panel = page.getByRole("complementary", { name: "Share" });
  await panel.getByRole("combobox").selectOption(role);
  const previous = (await panel.getByLabel("초대 링크").count())
    ? await panel.getByLabel("초대 링크").inputValue()
    : "";
  await panel.getByRole("button", { name: "초대 링크 만들기" }).click();
  await expect(panel.getByLabel("초대 링크")).toBeVisible();
  await expect(panel.getByLabel("초대 링크")).not.toHaveValue(previous);
  return panel.getByLabel("초대 링크").inputValue();
}
test("Offline edits survive a browser reload and sync after reconnecting", async ({
  page,
  context,
}) => {
  const name = `Offline ${Date.now()}`;
  await createWorkspace(page, name);
  await page.getByLabel("Page 제목").fill("Offline journal");
  await page
    .getByRole("textbox", { name: "문서 본문" })
    .fill("Before disconnect.");
  await expect(
    page.getByRole("button", { name: "서버 동기화 완료", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "서버 동기화 완료", exact: true })
    .click();
  await expect(
    page.getByTitle("Offline 준비됨", { exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await expect
    .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller))
    .toBe(true);
  await context.setOffline(true);
  await page.getByRole("textbox", { name: "문서 본문" }).click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type(" Offline addition.");
  await expect(
    page.getByRole("button", { name: "Offline", exact: true }),
  ).toBeVisible();
  await openPageTool(page, "Comments");
  await page.getByLabel("Comment 내용").fill("Offline comment");
  await page.getByRole("button", { name: "보내기", exact: true }).click();
  await expect(page.getByText("전송 대기", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("textbox", { name: "문서 본문" })).toContainText(
    "Offline addition.",
  );
  expect(
    await page.evaluate(async () => (await fetch("/design-icons/star.svg")).ok),
  ).toBe(true);
  await context.setOffline(false);
  const documentId = new URL(page.url()).searchParams.get("page");
  await expect
    .poll(async () => {
      const response = await page.request.get(
        `${ORIGIN}/v1/pages/${documentId}/comments`,
      );
      return response.status() === 200
        ? (await response.text()).includes("Offline comment")
        : false;
    })
    .toBe(true);
  await expect(
    page.getByRole("button", { name: "서버 동기화 완료", exact: true }),
  ).toBeVisible();
  await cleanup(page, name);
});
test("Mobile viewport supports full editing, capture and comments with touch", async ({
  browser,
}) => {
  const name = `Mobile ${Date.now()}`,
    context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    }),
    page = await context.newPage();
  try {
    await createWorkspace(page, name);
    await expect(
      page.getByRole("textbox", { name: "문서 본문" }),
    ).toHaveAttribute("contenteditable", "true");
    await page.getByLabel("Page 제목").fill("Mobile edited page");
    await page
      .getByRole("textbox", { name: "문서 본문" })
      .fill("Touch body editing");
    await expect(
      page.getByRole("button", { name: "서버 동기화 완료", exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("Page 제목")).toHaveValue(
      "Mobile edited page",
    );
    await expect(
      page.getByRole("textbox", { name: "문서 본문" }),
    ).toContainText("Touch body editing");
    await page.getByRole("button", { name: "Quick Capture 열기" }).tap();
    await expect(page.getByLabel("빠른 메모")).toBeFocused();
    await page.getByLabel("빠른 메모").fill("Mobile capture");
    await page.getByRole("button", { name: /^저장/ }).tap();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.getByRole("button", { name: "Comments", exact: true }).tap();
    await expect(
      page.getByRole("complementary", { name: "Comments" }),
    ).toBeVisible();
    await page.getByLabel("Comment 내용").fill("Touch comment");
    await page.getByRole("button", { name: "보내기", exact: true }).tap();
    await expect(
      page.getByText("Touch comment", { exact: true }),
    ).toBeVisible();
  } finally {
    await cleanup(page, name);
    await context.close();
  }
});

test("Slash Commands, stable Page Mention, Backlinks and Todo conversion", async ({
  page,
}) => {
  const name = `Knowledge ${Date.now()}`;
  await createWorkspace(page, name);
  await page.getByLabel("Page 제목").fill("Reference page");
  await page
    .getByRole("button", { name: "새 Page 만들기", exact: true })
    .click();
  await page.getByRole("button", { name: "새 문서", exact: true }).click();
  await expect(page.getByLabel("Page 제목")).toHaveValue("제목 없음");
  await page.getByLabel("Page 제목").fill("Linked notes");
  const editor = page.getByRole("textbox", { name: "문서 본문" });
  await editor.fill("");
  await editor.pressSequentially("[[Reference");
  await page
    .getByRole("option", { name: "Reference page", exact: true })
    .click();
  await expect(
    editor.getByRole("button", { name: "Reference page", exact: true }),
  ).toBeVisible();
  const sidebar = page.getByRole("complementary", { name: "Workspace 탐색" });
  await sidebar
    .getByRole("button", { name: "Reference page", exact: true })
    .click();
  await page.getByLabel("Page 제목").fill("Renamed reference");
  await openPageTool(page, "Backlinks");
  await page
    .getByRole("complementary", { name: "Backlinks" })
    .getByRole("button", { name: "Linked notes", exact: true })
    .click();
  await expect(
    editor.getByRole("button", { name: "Renamed reference", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Context Panel 닫기" }).click();
  await editor.fill("");
  await editor.pressSequentially("/todo");
  await page.getByRole("option", { name: /^Todo/ }).click();
  await editor.pressSequentially("  Implement feature  ");
  await page.getByRole("button", { name: "Block 메뉴", exact: true }).click();
  await page.getByRole("button", { name: "Task로 변환", exact: true }).click();
  await expect(
    editor.getByRole("button", { name: /Implement feature/ }),
  ).toBeVisible();
  await editor.getByRole("button", { name: /Implement feature/ }).click();
  await expect(page.getByLabel("Page 제목")).toHaveValue("Implement feature");
  await openPageTool(page, "Properties");
  await expect(
    page
      .getByRole("complementary", { name: "Properties" })
      .getByLabel("Status"),
  ).toHaveValue("todo");
  await cleanup(page, name);
});

test("Export and Import preserve document and Task data in a fresh workspace", async ({
  page,
}) => {
  const name = `Portable ${Date.now()}`;
  await createWorkspace(page, name);
  await page.getByLabel("Page 제목").fill("Portable document");
  await page
    .getByRole("textbox", { name: "문서 본문" })
    .fill("My portable knowledge.");
  await page.getByRole("button", { name: "To-Do", exact: true }).click();
  await page.getByRole("button", { name: "새 Task", exact: true }).click();
  await page.getByLabel("새 Task 제목").fill("Portable task");
  await page.getByRole("button", { name: "추가", exact: true }).click();
  await expect(page.getByLabel("Task 이름")).toHaveValue("Portable task");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const download = await downloadPromise,
    path = await download.path();
  if (!path) throw new Error("Export was not downloaded");
  await page
    .getByRole("dialog")
    .locator("input[type=file]")
    .setInputFiles(path);
  await expect(page.getByTestId("recovery-key")).toBeVisible();
  await page.getByRole("button", { name: "계속하기", exact: true }).click();
  const sidebar = page.getByRole("complementary", { name: "Workspace 탐색" });
  await sidebar
    .getByRole("button", { name: "Portable document", exact: true })
    .click();
  await expect(page.getByRole("textbox", { name: "문서 본문" })).toContainText(
    "My portable knowledge.",
  );
  await sidebar.getByRole("button", { name: "To-Do", exact: true }).click();
  await expect(page.getByLabel("Task 이름")).toHaveValue("Portable task");
  await expect(
    page.getByRole("button", { name: "서버 동기화 완료", exact: true }),
  ).toBeVisible();
  await cleanup(page, `${name} (가져옴)`);
});

test("Snapshot preview is read-only and restores a new Page while retaining the source", async ({
  page,
  context,
}) => {
  const name = `History ${Date.now()}`;
  await createWorkspace(page, name);
  const sourceUrl = page.url();
  await page.getByLabel("Page 제목").fill("Stable note");
  await expect(
    page.getByRole("button", { name: "서버 동기화 완료", exact: true }),
  ).toBeVisible();
  await openPageTool(page, "기록");
  const panel = page.getByRole("complementary", { name: "기록", exact: true });
  await panel.getByLabel("기록 이름").fill("Before edit");
  await panel.getByRole("button", { name: "현재 상태 기록하기" }).click();
  await expect(
    panel.getByRole("button", { name: /Before edit/ }),
  ).toBeVisible();
  await page.getByLabel("Page 제목").fill("Changed note");
  await expect(
    page.getByRole("button", { name: "서버 동기화 완료", exact: true }),
  ).toBeVisible();
  await panel.getByRole("button", { name: /Before edit/ }).click();
  await expect(panel.getByText("Stable note", { exact: true })).toBeVisible();
  await expect(
    panel.getByRole("textbox", { name: "문서 본문" }),
  ).toHaveAttribute("contenteditable", "false");
  await context.setOffline(true);
  await expect(
    panel.getByRole("button", { name: "새 Page로 복구" }),
  ).toBeDisabled();
  await context.setOffline(false);
  await expect(
    panel.getByRole("button", { name: "새 Page로 복구" }),
  ).toBeEnabled();
  await panel.getByRole("button", { name: "새 Page로 복구" }).click();
  await expect(page.getByLabel("Page 제목")).toHaveValue(/^Stable note \(복구/);
  expect(new URL(page.url()).searchParams.get("page")).not.toBe(
    new URL(sourceUrl).searchParams.get("page"),
  );
  await page.goto(sourceUrl);
  await expect(page.getByLabel("Page 제목")).toHaveValue("Changed note");
  await cleanup(page, name);
});

test("Generic properties, saved filters and date/card views survive Offline reload", async ({
  page,
  context,
}) => {
  const name = `Database ${Date.now()}`;
  await createWorkspace(page, name);
  await page
    .getByRole("button", { name: "새 Page 만들기", exact: true })
    .click();
  await page
    .getByRole("button", { name: "일반 Database", exact: true })
    .click();
  await expect(page.getByLabel("Page 제목")).toHaveValue("새 Database");
  await page.getByLabel("Page 제목").fill("제품 목록");
  await expect(page.getByLabel("Page 제목")).toHaveValue("제품 목록");
  const addProperty = async (
    propertyName: string,
    type: string,
    options?: string,
  ) => {
    await page.getByRole("button", { name: "속성", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Database 속성" });
    await dialog.getByLabel("새 속성 이름").fill(propertyName);
    await dialog.getByLabel("새 속성 종류").selectOption(type);
    if (options) await dialog.getByLabel("속성 선택 항목").fill(options);
    await dialog
      .getByRole("button", { name: "속성 추가", exact: true })
      .click();
    await expect(dialog.getByLabel(`${propertyName} 속성 이름`)).toHaveValue(
      propertyName,
    );
    await dialog
      .getByRole("button", { name: "닫기", exact: true })
      .last()
      .click();
  };
  await addProperty("Points", "number");
  await addProperty("단계", "select", "기획, 개발");
  await addProperty("출시일", "date");
  await addProperty("확인", "checkbox");
  for (const title of ["Alpha", "Beta", "Undated"]) {
    await page.getByRole("button", { name: "새 항목", exact: true }).click();
    await page.getByLabel("새 항목 제목").fill(title);
    await page.getByRole("button", { name: "추가", exact: true }).click();
  }
  await page.getByLabel("Alpha Points", { exact: true }).fill("2");
  await page.getByLabel("Alpha Points", { exact: true }).press("Tab");
  await page.getByLabel("Beta Points", { exact: true }).fill("10");
  await page.getByLabel("Beta Points", { exact: true }).press("Tab");
  await page
    .getByLabel("Alpha 단계", { exact: true })
    .selectOption({ label: "기획" });
  await page
    .getByLabel("Beta 단계", { exact: true })
    .selectOption({ label: "개발" });
  await page.getByLabel("Beta 확인", { exact: true }).check();
  const today = await page.evaluate(() =>
    new Date().toLocaleDateString("en-CA"),
  );
  await page.getByLabel("Alpha 출시일", { exact: true }).fill(today);
  await page.getByLabel("Beta 출시일", { exact: true }).fill(today);
  await page.screenshot({
    path: ".local/database-release/table.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Filter", exact: true }).click();
  await page.getByRole("button", { name: "필터 추가", exact: true }).click();
  await page.getByLabel("필터 1 속성").selectOption({ label: "Points" });
  await page.getByLabel("필터 1 조건").selectOption("gte");
  await page.getByLabel("필터 1 값").fill("5");
  await expect(page.getByLabel("항목 이름")).toHaveCount(1);
  await expect(page.getByLabel("항목 이름")).toHaveValue("Beta");
  await page.getByRole("button", { name: "보기 저장", exact: true }).click();
  await page.getByLabel("보기 이름").fill("큰 작업");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "저장", exact: true })
    .click();
  await expect(page.getByLabel("저장된 보기")).toContainText("큰 작업");
  await expect(
    page.locator(".sidebar").getByTestId("sync-status"),
  ).toHaveAttribute("data-state", "saved");
  await page.reload();
  await expect(page.getByLabel("Page 제목")).toHaveValue("제품 목록");
  await page.getByLabel("저장된 보기").selectOption({ label: "큰 작업" });
  await expect(page.getByLabel("항목 이름")).toHaveValue("Beta");
  await page.getByRole("button", { name: "Board", exact: true }).click();
  await expect(
    page
      .getByRole("region", { name: "개발", exact: true })
      .getByRole("button", { name: "Beta", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "미지정", exact: true })
      .getByRole("button", { name: "Undated", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Calendar", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Group", exact: true }),
  ).toHaveCount(0);
  await expect(
    page
      .getByRole("region", { name: "Calendar 날짜" })
      .getByRole("button", { name: "Alpha", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "날짜 없음 (1)" }),
  ).toBeVisible();
  await page.screenshot({
    path: ".local/database-release/calendar.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Timeline", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Group", exact: true }),
  ).toHaveCount(0);
  await expect(
    page
      .getByRole("region", { name: "Timeline 날짜" })
      .getByRole("button", { name: /^Beta .*부터/ }),
  ).toBeVisible();
  await page.screenshot({
    path: ".local/database-release/timeline.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Gallery", exact: true }).click();
  await expect(
    page.locator(".database-gallery").getByRole("button"),
  ).toHaveCount(3);
  await page.screenshot({
    path: ".local/database-release/gallery.png",
    fullPage: true,
  });
  await page
    .locator(".database-gallery")
    .getByRole("button")
    .filter({ hasText: "Beta" })
    .click();
  await expect(page.getByLabel("Page 제목")).toHaveValue("Beta");
  await expect(page.getByLabel("Beta Points")).toHaveValue("10");
  await expect(page.getByLabel("Beta 확인")).toBeChecked();
  await page.getByRole("button", { name: "프로젝트로 돌아가기" }).click();
  await page.getByRole("button", { name: "Table", exact: true }).click();
  await expect(
    page.locator(".sidebar").getByTestId("sync-status"),
  ).toHaveAttribute("data-state", "saved");
  const numberDraft = page.getByLabel("Beta Points", { exact: true });
  await numberDraft.fill("0");
  await numberDraft.press("Tab");
  await expect(numberDraft).toHaveValue("0");
  await numberDraft.fill("25");
  await numberDraft.evaluate((input) =>
    input.setAttribute("data-draft-probe", "focused"),
  );
  await context.setOffline(true);
  await expect(
    page.locator(".sidebar").getByTestId("sync-status"),
  ).toHaveAttribute("data-state", "offline");
  await expect(numberDraft).toHaveAttribute("data-draft-probe", "focused");
  await expect(numberDraft).toBeFocused();
  await expect(numberDraft).toHaveValue("25");
  await numberDraft.press("Tab");
  await page.waitForTimeout(500);
  await page.reload();
  await expect(page.getByLabel("Beta Points", { exact: true })).toHaveValue(
    "25",
  );
  await context.setOffline(false);
  await expect(
    page.locator(".sidebar").getByTestId("sync-status"),
  ).toHaveAttribute("data-state", "saved");
  await cleanup(page, name);
});

test("Custom database properties enforce Viewer access and survive server Snapshot recovery", async ({
  page,
  browser,
}) => {
  const name = `Database recovery ${Date.now()}`;
  await createWorkspace(page, name);
  await page.getByRole("button", { name: "To-Do", exact: true }).click();
  await page.getByRole("button", { name: "속성", exact: true }).click();
  await page.getByLabel("새 속성 이름").fill("Estimate");
  await page.getByLabel("새 속성 종류").selectOption("number");
  await page.getByRole("button", { name: "속성 추가", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "닫기", exact: true })
    .last()
    .click();
  await page.getByRole("button", { name: "새 Task", exact: true }).click();
  await page.getByLabel("새 Task 제목").fill("Shared Task");
  await page.getByRole("button", { name: "추가", exact: true }).click();
  await page.getByLabel("Shared Task Estimate", { exact: true }).fill("8");
  await page.getByLabel("Shared Task Estimate", { exact: true }).press("Tab");
  await page.getByRole("button", { name: "Sort", exact: true }).click();
  await page.getByRole("button", { name: "정렬 추가", exact: true }).click();
  await page.getByLabel("정렬 1 속성").selectOption({ label: "Estimate" });
  await page.getByRole("button", { name: "보기 저장", exact: true }).click();
  await page.getByLabel("보기 이름").fill("By estimate");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "저장", exact: true })
    .click();
  await expect(
    page.locator(".sidebar").getByTestId("sync-status"),
  ).toHaveAttribute("data-state", "saved");
  const viewerContext = await browser.newContext(),
    viewer = await viewerContext.newPage();
  try {
    const invite = await createInvite(page, "viewer");
    await viewer.goto(invite);
    await expect(viewer.getByLabel("Task 이름")).toHaveValue("Shared Task");
    await expect(
      viewer.getByLabel("Shared Task Estimate", { exact: true }),
    ).toHaveAttribute("readonly", "");
    await expect(
      viewer.getByRole("button", { name: "속성", exact: true }),
    ).toHaveCount(0);
    await expect(
      viewer.getByRole("button", { name: "보기 저장", exact: true }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "Context Panel 닫기" }).click();
    await openPageTool(page, "기록");
    const panel = page.getByRole("complementary", { name: "기록" });
    await panel.getByLabel("기록 이름").fill("Before estimate change");
    await panel.getByRole("button", { name: "현재 상태 기록하기" }).click();
    await expect(
      panel.getByRole("button", { name: /Before estimate change/ }),
    ).toBeVisible();
    await page.getByLabel("Shared Task Estimate", { exact: true }).fill("13");
    await page.getByLabel("Shared Task Estimate", { exact: true }).press("Tab");
    await expect(
      viewer.getByLabel("Shared Task Estimate", { exact: true }),
    ).toHaveValue("13");
    await panel.getByRole("button", { name: /Before estimate change/ }).click();
    await panel
      .getByLabel("기록 Task")
      .selectOption(
        (await panel
          .getByLabel("기록 Task")
          .locator("option")
          .filter({ hasText: "Shared Task" })
          .getAttribute("value"))!,
      );
    await expect(
      panel.getByLabel("Shared Task Estimate", { exact: true }),
    ).toHaveValue("8");
    await panel.getByRole("button", { name: "새 Page로 복구" }).click();
    await expect(panel).toHaveCount(0);
    await expect(page.getByLabel("Page 제목")).toHaveValue(/^To-Do \(복구/);
    await expect(
      page.getByLabel("Shared Task Estimate", { exact: true }),
    ).toHaveValue("8");
    await expect(page.getByLabel("저장된 보기")).toContainText("By estimate");
    const restoredId = new URL(page.url()).searchParams.get("page")!;
    const denied = await viewer.request.get(
      `${ORIGIN}/v1/documents/${restoredId}`,
    );
    expect(denied.status()).toBe(403);
  } finally {
    await viewerContext.close();
    await cleanup(page, name);
  }
});
