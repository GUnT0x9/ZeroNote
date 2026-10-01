import { test, expect, type Page } from "@playwright/test";
import { createBrowserBetaCode } from "./beta-helpers";
const ORIGIN = "http://localhost:3002";
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
    page.getByText("서버 동기화 완료", { exact: true }),
  ).toBeVisible();
  return key;
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
  await page
    .getByRole("button", { name: "나의 프로젝트", exact: true })
    .click();
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
  await page
    .getByRole("button", { name: "Quick Capture", exact: true })
    .click();
  await page
    .getByLabel("빠른 메모")
    .fill("Captured thought\nKeep this offline.");
  await page.getByLabel("빠른 메모").press("Control+Enter");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: /Inbox/ }).click();
  await expect(
    page.getByRole("button", { name: /Captured thought/ }),
  ).toBeVisible();
  await cleanup(page, name);
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
    page.getByText("서버 동기화 완료", { exact: true }),
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
  await member.getByRole("button", { name: "Comments", exact: true }).click();
  await member.getByLabel("Comment 내용").fill("Ready for review");
  await member.getByRole("button", { name: "보내기", exact: true }).click();
  await page.getByRole("button", { name: "Comments", exact: true }).click();
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
    page.getByText("서버 동기화 완료", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByTitle("Offline 준비됨", { exact: true }),
  ).toBeVisible();
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
    page.getByText("Offline · 이 기기에 저장됨", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Comments", exact: true }).click();
  await page.getByLabel("Comment 내용").fill("Offline comment");
  await page.getByRole("button", { name: "보내기", exact: true }).click();
  await expect(page.getByText("전송 대기", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("textbox", { name: "문서 본문" })).toContainText(
    "Offline addition.",
  );
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
    page.getByText("서버 동기화 완료", { exact: true }),
  ).toBeVisible();
  await cleanup(page, name);
});
test("Mobile viewport supports reading, capture and comments without exposing full editing", async ({
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
    ).toHaveAttribute("contenteditable", "false");
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
  await page.getByRole("button", { name: "Backlinks", exact: true }).click();
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
  await page.getByRole("button", { name: "Properties", exact: true }).click();
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
  await page
    .getByRole("button", { name: "나의 프로젝트", exact: true })
    .click();
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
  await sidebar
    .getByRole("button", { name: "나의 프로젝트", exact: true })
    .click();
  await expect(page.getByLabel("Task 이름")).toHaveValue("Portable task");
  await expect(
    page.getByText("서버 동기화 완료", { exact: true }),
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
    page.getByText("서버 동기화 완료", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "기록", exact: true }).click();
  const panel = page.getByRole("complementary", { name: "기록", exact: true });
  await panel.getByLabel("기록 이름").fill("Before edit");
  await panel.getByRole("button", { name: "현재 상태 기록하기" }).click();
  await expect(
    panel.getByRole("button", { name: /Before edit/ }),
  ).toBeVisible();
  await page.getByLabel("Page 제목").fill("Changed note");
  await expect(
    page.getByText("서버 동기화 완료", { exact: true }),
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
