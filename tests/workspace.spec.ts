import { test, expect, type Page, type Locator } from "@playwright/test";
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
  if (await page.getByRole("complementary", { name, exact: true }).isVisible())
    return;
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
  await panel.getByLabel("초대 권한").selectOption(role);
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
  await panel.getByLabel("초대 권한").selectOption(role);
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

test("Page Tags converge across devices, survive Offline reload and restore from Snapshot with Viewer enforcement", async ({
  page,
  context,
  browser,
}) => {
  const name = `Tags ${Date.now()}`,
    title = `Tagged ${Date.now()}`;
  const editorContext = await browser.newContext({
      viewport: { width: 1440, height: 960 },
    }),
    viewerContext = await browser.newContext({
      viewport: { width: 1440, height: 960 },
    }),
    collaborator = await editorContext.newPage(),
    viewer = await viewerContext.newPage();
  const tags = (target: Page) =>
    target.getByRole("region", { name: "Page Tags", exact: true });
  const add = async (target: Page, tag: string) => {
    await tags(target).getByLabel("Tag 추가").fill(tag);
    await tags(target)
      .getByRole("button", { name: "추가", exact: true })
      .click();
    await expect(tags(target).getByLabel("Tag 추가")).toHaveValue("");
  };
  try {
    await createWorkspace(page, name);
    await page.getByLabel("Page 제목").fill(title);
    await openPageTool(page, "Properties");
    await add(page, "Team");
    await add(page, "team");
    await expect(tags(page).getByRole("listitem")).toHaveCount(1);
    await tags(page)
      .getByRole("button", { name: "Tag team 이름 변경", exact: true })
      .click();
    await tags(page).getByLabel("Tag 이름", { exact: true }).fill("설계");
    await tags(page)
      .getByRole("button", { name: "Tag 이름 저장", exact: true })
      .click();
    await expect(tags(page).getByText("설계", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "서버 동기화 완료", exact: true }),
    ).toBeVisible();
    await collaborator.goto(await createInvite(page, "editor"));
    await expect(collaborator.getByLabel("Page 제목")).toHaveValue(title);
    await openPageTool(collaborator, "Properties");
    await add(collaborator, "협업");
    await openPageTool(page, "Properties");
    await expect(tags(page).getByText("협업", { exact: true })).toBeVisible();
    await viewer.goto(await createInvite(page, "viewer"));
    await expect(viewer.getByLabel("Page 제목")).toHaveValue(title);
    await openPageTool(viewer, "Properties");
    await expect(tags(viewer).getByText("협업", { exact: true })).toBeVisible();
    await expect(tags(viewer).getByLabel("Tag 추가")).toHaveCount(0);
    await expect(tags(viewer).getByRole("button")).toHaveCount(0);
    await openPageTool(page, "Properties");
    await page.evaluate(() =>
      navigator.serviceWorker.ready.then(() => undefined),
    );
    await context.setOffline(true);
    await add(page, "Offline");
    await tags(page)
      .getByRole("button", { name: "Tag 설계 삭제", exact: true })
      .click();
    await expect(tags(page).getByText("설계", { exact: true })).toHaveCount(0);
    await page.reload();
    await expect(page.getByLabel("Page 제목")).toHaveValue(title);
    await openPageTool(page, "Properties");
    await expect(
      tags(page).getByText("Offline", { exact: true }),
    ).toBeVisible();
    await expect(tags(page).getByText("협업", { exact: true })).toBeVisible();
    await expect(tags(page).getByText("설계", { exact: true })).toHaveCount(0);
    await context.setOffline(false);
    await expect(
      page.getByRole("button", { name: "서버 동기화 완료", exact: true }),
    ).toBeVisible();
    await expect(
      tags(collaborator).getByText("Offline", { exact: true }),
    ).toBeVisible();
    await expect(
      tags(collaborator).getByText("설계", { exact: true }),
    ).toHaveCount(0);
    await openPageTool(page, "기록");
    const history = page.getByRole("complementary", {
      name: "기록",
      exact: true,
    });
    await history.getByLabel("기록 이름").fill("Tagged checkpoint");
    await history.getByRole("button", { name: "현재 상태 기록하기" }).click();
    await history.getByRole("button", { name: /Tagged checkpoint/ }).click();
    await expect(
      tags(page).getByText("Offline", { exact: true }),
    ).toBeVisible();
    await expect(tags(page).getByRole("button")).toHaveCount(0);
    await history.getByRole("button", { name: "새 Page로 복구" }).click();
    await expect(page.getByLabel("Page 제목")).toHaveValue(
      new RegExp(`^${title} \\(복구`),
    );
    await openPageTool(page, "Properties");
    await expect(
      tags(page).getByText("Offline", { exact: true }),
    ).toBeVisible();
    await expect(tags(page).getByText("협업", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Page 메뉴", exact: true }).click();
    await page.getByRole("button", { name: "Page 복제", exact: true }).click();
    await expect(page.getByLabel("Page 제목")).toHaveValue(/\(복사\)$/);
    await openPageTool(page, "Properties");
    await expect(
      tags(page).getByText("Offline", { exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Control+k");
    await page
      .getByRole("dialog", { name: "Search", exact: true })
      .getByRole("textbox")
      .fill("Offline");
    await expect(
      page
        .getByRole("dialog", { name: "Search", exact: true })
        .getByText(title, { exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
  } finally {
    await context.setOffline(false);
    await cleanup(page, name);
    await editorContext.close();
    await viewerContext.close();
  }
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

test("File Formula Relation and Rollup stay consistent through rename Offline reload and Snapshot copy", async ({
  page,
  context,
  browser,
}) => {
  test.setTimeout(180000);
  const name = `Advanced Database ${Date.now()}`;
  try {
    await createWorkspace(page, name);
    const newDatabase = async (title: string) => {
      await page
        .getByRole("button", { name: "새 Page 만들기", exact: true })
        .click();
      await page
        .getByRole("button", { name: "일반 Database", exact: true })
        .click();
      await expect(page.getByLabel("Page 제목")).toHaveValue("새 Database");
      await page.getByLabel("Page 제목").fill(title);
    };
    const addProperty = async (
      title: string,
      type: string,
      configure?: (dialog: Locator) => Promise<void>,
    ) => {
      await page.getByRole("button", { name: "속성", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Database 속성" });
      await dialog.getByLabel("새 속성 이름").fill(title);
      await dialog.getByLabel("새 속성 종류").selectOption(type);
      if (configure) await configure(dialog);
      await dialog
        .getByRole("button", { name: "속성 추가", exact: true })
        .click();
      await expect(dialog.getByLabel(`${title} 속성 이름`)).toBeVisible();
      await dialog
        .getByRole("button", { name: "닫기", exact: true })
        .last()
        .click();
    };
    const addRow = async (title: string) => {
      await page.getByRole("button", { name: "새 항목", exact: true }).click();
      await page.getByLabel("새 항목 제목").fill(title);
      await page.getByRole("button", { name: "추가", exact: true }).click();
    };
    await newDatabase("자료 DB");
    await addProperty("점수", "number");
    await addRow("Alpha");
    await page.getByLabel("Alpha 점수", { exact: true }).fill("6");
    await page.getByLabel("Alpha 점수", { exact: true }).press("Tab");
    const targetId = new URL(page.url()).searchParams.get("page")!;
    await newDatabase("계획 DB");
    await addRow("Project");
    const sourceUrl = page.url();
    await addProperty("자료", "relation", async (dialog) => {
      await dialog
        .getByLabel("Relation 대상 Database")
        .selectOption({ label: "자료 DB" });
    });
    await page.getByRole("button", { name: "Project 자료 연결 선택" }).click();
    await page
      .getByRole("group", { name: "Project 자료 연결 항목" })
      .getByRole("checkbox", { name: "Alpha", exact: true })
      .check();
    await page
      .getByRole("group", { name: "Project 자료 연결 항목" })
      .getByRole("button", { name: "닫기", exact: true })
      .click();
    await addProperty("집계", "rollup", async (dialog) => {
      await dialog
        .getByLabel("Rollup Relation")
        .selectOption({ label: "자료" });
      await dialog
        .getByLabel("Rollup 집계 속성")
        .selectOption({ label: "점수" });
      await dialog.getByLabel("Rollup 계산").selectOption("sum");
    });
    await addProperty("두 배", "formula", async (dialog) => {
      await dialog.getByLabel("Formula 수식").fill('prop("집계") * 2');
      await expect(dialog.getByLabel("Formula 미리보기")).toContainText("12");
    });
    await addProperty("첨부", "file");
    await page.getByLabel("Project 첨부 파일 추가").setInputFiles({
      name: "field.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Property file bytes"),
    });
    await expect(page.getByLabel("Project 집계", { exact: true })).toHaveText(
      "6",
    );
    await expect(page.getByLabel("Project 두 배", { exact: true })).toHaveText(
      "12",
    );
    await page
      .getByRole("button", { name: "field.txt 미리보기", exact: true })
      .click();
    const preview = page.getByRole("dialog", { name: "field.txt" });
    await expect(preview.locator("pre")).toHaveText("Property file bytes");
    const download = page.waitForEvent("download");
    await preview.getByRole("link", { name: "다운로드" }).click();
    expect((await readFile((await (await download).path())!)).toString()).toBe(
      "Property file bytes",
    );
    await preview.getByRole("button", { name: "닫기", exact: true }).click();
    await page.getByRole("button", { name: "속성", exact: true }).click();
    const properties = page.getByRole("dialog", { name: "Database 속성" });
    await properties.getByLabel("집계 속성 이름").fill("합계");
    await properties.getByLabel("집계 속성 이름").press("Tab");
    await properties.getByRole("button", { name: "두 배 속성 설정" }).click();
    await expect(properties.getByLabel("Formula 수식").first()).toHaveValue(
      /합계/,
    );
    await properties.getByRole("button", { name: "취소", exact: true }).click();
    await properties
      .getByRole("button", { name: "닫기", exact: true })
      .last()
      .click();
    await expect(page.getByLabel("Project 두 배", { exact: true })).toHaveText(
      "12",
    );
    await page.getByRole("button", { name: "Alpha", exact: true }).click();
    await page.getByLabel("Page 제목").fill("Renamed Alpha");
    await page.getByLabel("Renamed Alpha 점수", { exact: true }).fill("7");
    await page.getByLabel("Renamed Alpha 점수", { exact: true }).press("Tab");
    await page.goto(sourceUrl);
    await expect(
      page.getByRole("button", { name: "Renamed Alpha", exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel("Project 두 배", { exact: true })).toHaveText(
      "14",
    );
    await expect(
      page.locator(".sidebar").getByTestId("sync-status"),
    ).toHaveAttribute("data-state", "saved");
    await context.setOffline(true);
    await page.reload();
    await expect(page.getByLabel("Project 두 배", { exact: true })).toHaveText(
      "14",
    );
    await expect(
      page.getByRole("button", { name: "field.txt 미리보기", exact: true }),
    ).toBeVisible();
    await context.setOffline(false);
    await expect(
      page.locator(".sidebar").getByTestId("sync-status"),
    ).toHaveAttribute("data-state", "saved");
    await page.screenshot({
      path: ".local/database-advanced/table.png",
      fullPage: true,
    });
    const viewerContext = await browser.newContext();
    try {
      const invite = await createInvite(page, "viewer"),
        viewer = await viewerContext.newPage();
      await viewer.goto(invite);
      await expect(
        viewer.getByLabel("Project 두 배", { exact: true }),
      ).toContainText("대상 Database");
      await expect(viewer.getByLabel("Project 첨부 파일 추가")).toHaveCount(0);
      await expect(
        viewer.getByRole("button", { name: "Renamed Alpha", exact: true }),
      ).toHaveCount(0);
      expect(
        (
          await viewer.request.get(`${ORIGIN}/v1/documents/${targetId}`, {
            headers: { "X-ZeroNote-Editor-Protocol": "3" },
          })
        ).status(),
      ).toBe(403);
      const sourceId = new URL(sourceUrl).searchParams.get("page")!;
      const state = await viewer.request.get(
        `${ORIGIN}/v1/documents/${sourceId}`,
        { headers: { "X-ZeroNote-Editor-Protocol": "3" } },
      );
      expect(state.status()).toBe(200);
      const current = (await state.json()) as { update: string };
      expect(
        (
          await viewer.request.post(
            `${ORIGIN}/v1/documents/${sourceId}/commit`,
            {
              headers: { origin: ORIGIN, "X-ZeroNote-Editor-Protocol": "3" },
              data: {
                operationId: crypto.randomUUID(),
                update: current.update,
              },
            },
          )
        ).status(),
      ).toBe(403);
      await expect(
        viewer.getByRole("button", { name: "field.txt 미리보기", exact: true }),
      ).toBeVisible();
      await viewer
        .getByRole("button", { name: "field.txt 미리보기", exact: true })
        .click();
      await expect(
        viewer.getByRole("dialog", { name: "field.txt" }).locator("pre"),
      ).toHaveText("Property file bytes");
      await viewer
        .getByRole("dialog", { name: "field.txt" })
        .getByRole("button", { name: "닫기", exact: true })
        .click();
      await page.getByRole("button", { name: "Context Panel 닫기" }).click();
      const targetUrl = new URL(sourceUrl);
      targetUrl.searchParams.set("page", targetId);
      await page.goto(targetUrl.toString());
      const targetInvite = await createInvite(page, "viewer");
      await viewer.goto(targetInvite);
      await expect(
        viewer.getByRole("button", { name: "Renamed Alpha 열기", exact: true }),
      ).toBeVisible();
      await viewer.goto(sourceUrl);
      await expect(
        viewer.getByLabel("Project 두 배", { exact: true }),
      ).toHaveText("14");
      // Refresh the grant list after the other Device has accepted it.
      await page.getByRole("button", { name: "Context Panel 닫기" }).click();
      await page.getByRole("button", { name: "Share", exact: true }).click();
      await page
        .getByRole("complementary", { name: "Share" })
        .getByRole("button", { name: "철회", exact: true })
        .click();
      await expect(
        viewer.getByLabel("Project 두 배", { exact: true }),
      ).toContainText("대상 Database");
      await expect(
        viewer.getByRole("button", { name: "Renamed Alpha", exact: true }),
      ).toHaveCount(0);
      expect(
        (
          await viewer.request.get(`${ORIGIN}/v1/documents/${targetId}`, {
            headers: { "X-ZeroNote-Editor-Protocol": "3" },
          })
        ).status(),
      ).toBe(403);
      await page.goto(sourceUrl);
    } finally {
      await viewerContext.close();
    }
    const closeContextPanel = page.getByRole("button", {
      name: "Context Panel 닫기",
    });
    if (await closeContextPanel.isVisible()) await closeContextPanel.click();
    await openPageTool(page, "기록");
    const panel = page.getByRole("complementary", { name: "기록" });
    await panel.getByLabel("기록 이름").fill("Properties checkpoint");
    await panel.getByRole("button", { name: "현재 상태 기록하기" }).click();
    await panel.getByRole("button", { name: /Properties checkpoint/ }).click();
    await panel
      .getByLabel("기록 Task")
      .selectOption(
        (await panel
          .getByLabel("기록 Task")
          .locator("option")
          .filter({ hasText: "Project" })
          .getAttribute("value"))!,
      );
    await expect(panel.getByLabel("Project 두 배", { exact: true })).toHaveText(
      "14",
    );
    await expect(panel.getByLabel("Project 첨부 파일 추가")).toHaveCount(0);
    await panel.getByRole("button", { name: "새 Page로 복구" }).click();
    await expect(page.getByLabel("Page 제목")).toHaveValue(/^계획 DB \(복구/);
    await expect(page.getByLabel("Project 두 배", { exact: true })).toHaveText(
      "14",
    );
    await page
      .getByRole("button", { name: "field.txt 미리보기", exact: true })
      .click();
    await expect(
      page.getByRole("dialog", { name: "field.txt" }).locator("pre"),
    ).toHaveText("Property file bytes");
    await page
      .getByRole("dialog", { name: "field.txt" })
      .getByRole("button", { name: "닫기", exact: true })
      .click();
  } finally {
    await context.setOffline(false);
    await cleanup(page, name);
  }
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

test("Storage UI protects active files, purges unused bytes and retains Offline pending files while clearing cache", async ({
  page,
  context,
}) => {
  const name = `Storage ${Date.now()}`;
  try {
    await createWorkspace(page, name);
    await page.getByLabel("첨부 파일 선택").setInputFiles({
      name: "keep-qa.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("keep bytes"),
    });
    await expect(
      page.getByRole("button", { name: "서버 동기화 완료", exact: true }),
    ).toBeVisible();
    const pageId = new URL(page.url()).searchParams.get("page"),
      unusedId = crypto.randomUUID();
    const upload = await page.request.post(
      `${ORIGIN}/v1/pages/${pageId}/attachments`,
      {
        headers: { origin: ORIGIN },
        data: {
          id: unusedId,
          operationId: crypto.randomUUID(),
          name: "unused-qa.txt",
          data: Buffer.from("unused bytes").toString("base64"),
        },
      },
    );
    expect(upload.ok()).toBe(true);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: "저장 공간", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "저장 공간" });
    await expect(
      dialog.getByText("unused-qa.txt", { exact: true }),
    ).toBeVisible();
    await dialog
      .getByRole("button", { name: "keep-qa.txt 파일 정리", exact: true })
      .click();
    await dialog.getByLabel("정리할 파일 이름").fill("keep-qa.txt");
    await dialog
      .getByRole("button", { name: "영구 정리하기", exact: true })
      .click();
    await expect(dialog.getByRole("alert")).toContainText("사용 중");
    await dialog.getByRole("button", { name: "취소", exact: true }).click();
    await dialog
      .getByRole("button", { name: "unused-qa.txt 파일 정리", exact: true })
      .click();
    await dialog.getByLabel("정리할 파일 이름").fill("wrong.txt");
    await expect(
      dialog.getByRole("button", { name: "영구 정리하기", exact: true }),
    ).toBeDisabled();
    await dialog.getByLabel("정리할 파일 이름").fill("unused-qa.txt");
    await dialog
      .getByRole("button", { name: "영구 정리하기", exact: true })
      .click();
    await expect(
      dialog.getByText("unused-qa.txt", { exact: true }),
    ).toHaveCount(0);
    expect(
      (await page.request.get(`${ORIGIN}/v1/attachments/${unusedId}`)).status(),
    ).toBe(410);
    await dialog.getByRole("button", { name: "닫기", exact: true }).click();
    await page
      .getByRole("dialog", { name: "Settings" })
      .getByRole("button", { name: "닫기", exact: true })
      .click();
    await context.setOffline(true);
    await page.getByLabel("첨부 파일 선택").setInputFiles({
      name: "pending-qa.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("pending bytes"),
    });
    await expect(
      page.getByText("pending-qa.txt", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: "저장 공간", exact: true }).click();
    await expect(dialog.getByText(/미전송\/보존 1개/)).toBeVisible();
    await dialog
      .getByRole("button", { name: "오프라인 파일 사본 제거", exact: true })
      .click();
    await dialog
      .getByRole("button", { name: "사본 제거하기", exact: true })
      .click();
    await expect(dialog.getByText(/1개 파일 · 미전송\/보존 1개/)).toBeVisible();
    await page.reload();
    const pending = page.getByRole("link", {
      name: "pending-qa.txt 다운로드",
      exact: true,
    });
    await expect(pending).toHaveAttribute("href", /^blob:/);
    await context.setOffline(false);
    await expect(
      page.getByRole("button", { name: "서버 동기화 완료", exact: true }),
    ).toBeVisible();
    const waiting = page.waitForEvent("download");
    await pending.click();
    const download = await waiting,
      path = await download.path();
    if (!path) throw new Error("Missing pending file after reconnect");
    expect((await readFile(path)).toString()).toBe("pending bytes");
  } finally {
    await context.setOffline(false);
    await cleanup(page, name);
  }
});

test("Public Page reads without a Device, serves referenced images, applies SEO opt-in and revoke", async ({
  page,
  browser,
}) => {
  const name = `Public Page ${Date.now()}`,
    visitorContext = await browser.newContext(),
    visitor = await visitorContext.newPage();
  try {
    await createWorkspace(page, name);
    await page.getByLabel("Page 제목").fill("Published guide");
    await page
      .getByRole("textbox", { name: "문서 본문" })
      .fill("Public content for a visitor");
    await page.getByLabel("첨부 파일 선택").setInputFiles({
      name: "public.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5WQAAAAASUVORK5CYII=",
        "base64",
      ),
    });
    await expect(page.locator(".attachment-caption small")).toContainText(
      "서버 저장됨",
    );
    await page.getByRole("button", { name: "Share", exact: true }).click();
    await page.getByText("웹에 게시 · 공개 링크", { exact: true }).click();
    const manager = page.locator(".public-share-manager");
    await manager
      .getByRole("button", { name: "공개 링크 만들기", exact: true })
      .click();
    await expect(
      manager.getByLabel("공개 링크", { exact: true }),
    ).toBeVisible();
    let url = await manager
      .getByLabel("공개 링크", { exact: true })
      .inputValue();
    const privateRequests: string[] = [];
    visitor.on("websocket", (socket) => privateRequests.push(socket.url()));
    visitor.on("request", (request) => {
      if (/\/v1\/(devices|auth|workspaces)|\/collaboration/.test(request.url()))
        privateRequests.push(request.url());
    });
    await visitor.goto(url);
    await expect(
      visitor.getByRole("heading", { name: "Published guide", exact: true }),
    ).toBeVisible();
    await expect(visitor.locator(".public-document")).toContainText(
      "Public content for a visitor",
    );
    await expect
      .poll(() =>
        visitor
          .getByAltText("public.png")
          .evaluate((element) => (element as HTMLImageElement).naturalWidth),
      )
      .toBe(1);
    expect(privateRequests).toEqual([]);
    expect(
      await visitor.evaluate(async () => (await indexedDB.databases()).length),
    ).toBe(0);
    await expect(visitor.locator('meta[name="robots"]')).toHaveAttribute(
      "content",
      "noindex, nofollow",
    );
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    const controlledPublic = await page.context().newPage();
    try {
      await controlledPublic.goto(url);
      await expect(controlledPublic.locator(".public-document")).toContainText(
        "Public content for a visitor",
      );
      const cachedPublicRequests = await page.evaluate(async () => {
        let count = 0;
        for (const name of await caches.keys()) {
          const cache = await caches.open(name);
          count += (await cache.keys()).filter((request) => {
            const path = new URL(request.url).pathname;
            return path.startsWith("/s/") || path.startsWith("/v1/public/");
          }).length;
        }
        return count;
      });
      expect(cachedPublicRequests).toBe(0);
      await page.context().setOffline(true);
      await expect(controlledPublic.reload()).rejects.toThrow();
      await expect(controlledPublic.getByLabel("Page 제목")).toHaveCount(0);
    } finally {
      await page.context().setOffline(false);
      await controlledPublic.close();
    }
    expect(await visitorContext.cookies()).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "zn_session" })]),
    );
    await manager
      .getByRole("checkbox", { name: "검색 엔진에 등록 허용" })
      .check();
    await manager
      .getByRole("button", { name: "공개 링크 만들기", exact: true })
      .click();
    await expect(
      manager.getByLabel("공개 링크", { exact: true }),
    ).not.toHaveValue(url);
    url = await manager.getByLabel("공개 링크", { exact: true }).inputValue();
    await visitor.goto(url);
    await expect(visitor.locator('meta[name="robots"]')).toHaveAttribute(
      "content",
      "index, follow",
    );
    await expect(visitor.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      new RegExp(`/s/${new URL(url).pathname.split("/")[2]}/`),
    );
    const source = await visitor.request.get(url);
    expect(source.headers()["cache-control"]).toContain("no-store");
    expect(await source.text()).toContain("Public content for a visitor");
    await page
      .getByRole("textbox", { name: "문서 본문" })
      .fill("Changed published body");
    await expect(
      page.getByRole("button", { name: "서버 동기화 완료", exact: true }),
    ).toBeVisible();
    await visitor
      .getByRole("button", { name: "새로고침", exact: true })
      .click();
    await expect(visitor.locator(".public-document")).toContainText(
      "Changed published body",
    );
    await manager
      .getByRole("button", { name: "게시 해제", exact: true })
      .first()
      .click();
    await manager
      .getByRole("button", { name: "게시 해제 확인", exact: true })
      .click();
    await expect(
      manager.getByText("게시 해제됨", { exact: true }),
    ).toBeVisible();
    await visitor
      .getByRole("button", { name: "새로고침", exact: true })
      .click();
    await expect(
      visitor.locator(".public-shell").getByRole("alert"),
    ).toContainText("만료");
    await expect(visitor.locator(".public-document")).toHaveCount(0);
  } finally {
    await visitorContext.close();
    await cleanup(page, name);
  }
});

test("Password, Temporary and Burn links gate opening, resume scoped cookies and allow exactly one browser", async ({
  page,
  browser,
}) => {
  const name = `Protected Public ${Date.now()}`,
    firstContext = await browser.newContext(),
    secondContext = await browser.newContext(),
    first = await firstContext.newPage(),
    second = await secondContext.newPage();
  try {
    await createWorkspace(page, name);
    await page.getByLabel("Page 제목").fill("Protected body title");
    await page
      .getByRole("textbox", { name: "문서 본문" })
      .fill("First frozen body");
    await page.getByRole("button", { name: "Share", exact: true }).click();
    await page.getByText("웹에 게시 · 공개 링크", { exact: true }).click();
    const manager = page.locator(".public-share-manager");
    await manager.getByRole("checkbox", { name: "비밀번호 필요" }).check();
    await manager.getByLabel("공유 비밀번호").fill("correct password");
    await expect(
      manager.getByRole("checkbox", { name: "검색 엔진에 등록 허용" }),
    ).toBeDisabled();
    await manager
      .getByRole("button", { name: "공개 링크 만들기", exact: true })
      .click();
    await expect(
      manager.getByLabel("공개 링크", { exact: true }),
    ).toBeVisible();
    let url = await manager
      .getByLabel("공개 링크", { exact: true })
      .inputValue();
    expect(new URL(url).hash).toMatch(/^#[a-f0-9]{64}$/);
    await first.goto(url);
    await expect(
      first.getByRole("heading", { name: "보호된 문서" }),
    ).toBeVisible();
    await expect(
      first.getByText("First frozen body", { exact: true }),
    ).toHaveCount(0);
    await first.getByLabel("문서 비밀번호").fill("wrong");
    await first.getByRole("button", { name: "문서 열기" }).click();
    await expect(
      first.locator(".public-shell").getByRole("alert"),
    ).toContainText("올바르지");
    await first.getByLabel("문서 비밀번호").fill("correct password");
    await first.getByRole("button", { name: "문서 열기" }).click();
    await expect(
      first.getByRole("heading", { name: "Protected body title" }),
    ).toBeVisible();
    expect(new URL(first.url()).hash).toBe("");
    const session = (await firstContext.cookies()).find((cookie) =>
      cookie.name.startsWith("zn_public_"),
    );
    expect(session).toMatchObject({
      httpOnly: true,
      sameSite: "Strict",
      secure: ORIGIN.startsWith("https://"),
      path: `/v1/public/${new URL(url).pathname.split("/")[2]}`,
    });
    await first.reload();
    await expect(first.locator(".public-document")).toContainText(
      "First frozen body",
    );
    await manager.getByRole("checkbox", { name: "비밀번호 필요" }).uncheck();
    await manager.getByLabel("공유 방식").selectOption("temporary");
    await manager
      .getByRole("button", { name: "공개 링크 만들기", exact: true })
      .click();
    await expect(
      manager.getByLabel("공개 링크", { exact: true }),
    ).not.toHaveValue(url);
    url = await manager.getByLabel("공개 링크", { exact: true }).inputValue();
    await second.goto(url);
    await second.getByRole("button", { name: "문서 열기" }).click();
    await expect(second.locator(".public-document")).toContainText(
      "First frozen body",
    );
    await manager.getByLabel("공유 방식").selectOption("burn");
    await manager
      .getByRole("button", { name: "공개 링크 만들기", exact: true })
      .click();
    await expect(
      manager.getByLabel("공개 링크", { exact: true }),
    ).not.toHaveValue(url);
    url = await manager.getByLabel("공개 링크", { exact: true }).inputValue();
    await second.request.get(
      `${ORIGIN}/v1/public/${new URL(url).pathname.split("/")[2]}`,
    );
    await first.goto(url);
    await first.getByRole("button", { name: "문서 열기" }).click();
    await expect(first.locator(".public-document")).toContainText(
      "First frozen body",
    );
    await page
      .getByRole("textbox", { name: "문서 본문" })
      .fill("Later private edits");
    await expect(
      page.getByRole("button", { name: "서버 동기화 완료", exact: true }),
    ).toBeVisible();
    await first.reload();
    await expect(first.locator(".public-document")).toContainText(
      "First frozen body",
    );
    await expect(first.locator(".public-document")).not.toContainText(
      "Later private edits",
    );
    await second.goto(url);
    await second.getByRole("button", { name: "문서 열기" }).click();
    await expect(
      second.locator(".public-shell").getByRole("alert"),
    ).toContainText("이미 열린");
    await expect(second.locator(".public-document")).toHaveCount(0);
    await expect(second.locator('meta[name="robots"]')).toHaveAttribute(
      "content",
      "noindex, nofollow",
    );
  } finally {
    await firstContext.close();
    await secondContext.close();
    await cleanup(page, name);
  }
});

test("Public Workspace lists only selected Pages and publishes Database rows read-only", async ({
  page,
  browser,
}) => {
  const name = `Public Workspace ${Date.now()}`,
    context = await browser.newContext(),
    visitor = await context.newPage();
  try {
    await createWorkspace(page, name);
    await page
      .getByRole("textbox", { name: "문서 본문" })
      .fill("Workspace public guide");
    await page.getByRole("button", { name: "To-Do", exact: true }).click();
    await page.getByRole("button", { name: "새 Task", exact: true }).click();
    await page.getByLabel("새 Task 제목").fill("Published task");
    await page.getByRole("button", { name: "추가", exact: true }).click();
    await page
      .getByRole("button", { name: "Published task 열기", exact: true })
      .click();
    await page
      .getByRole("textbox", { name: "문서 본문" })
      .fill("Published task body");
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: "공개 공유", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Workspace 공개 공유" });
    await dialog
      .getByRole("checkbox", { name: "시작하기", exact: true })
      .check();
    await dialog.getByRole("checkbox", { name: "To-Do", exact: true }).check();
    await dialog
      .getByRole("button", { name: "공개 링크 만들기", exact: true })
      .click();
    await expect(dialog.getByLabel("공개 링크", { exact: true })).toBeVisible();
    await visitor.goto(
      await dialog.getByLabel("공개 링크", { exact: true }).inputValue(),
    );
    await expect(
      visitor.getByRole("navigation", { name: "공개 Page" }).getByRole("link"),
    ).toHaveCount(2);
    await expect(visitor.locator(".public-document")).toContainText(
      "Workspace public guide",
    );
    await visitor
      .getByRole("navigation", { name: "공개 Page" })
      .getByRole("link", { name: "To-Do", exact: true })
      .click();
    await expect(visitor.locator(".public-table")).toContainText(
      "Published task",
    );
    await expect(visitor.locator(".public-table")).not.toContainText(
      "Assignee",
    );
    await visitor
      .locator(".public-document summary")
      .getByText("Published task", { exact: true })
      .click();
    await expect(
      visitor.getByText("Published task body", { exact: true }),
    ).toBeVisible();
    await expect(visitor.locator('[contenteditable="true"]')).toHaveCount(0);
    await expect(
      visitor.getByRole("navigation", { name: "공개 Page" }),
    ).not.toContainText("Inbox");
    expect(
      await visitor.evaluate(async () => (await indexedDB.databases()).length),
    ).toBe(0);
  } finally {
    await context.close();
    await cleanup(page, name);
  }
});
