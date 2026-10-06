import { test, expect } from "@playwright/test";
import * as Y from "yjs";
import { writeFile } from "node:fs/promises";
import {
  createTaskRow,
  getDocumentProjection,
} from "../packages/shared/src/index";
import type { LocalPage, LocalDocument } from "../apps/web/src/lib/database";
import { createBrowserBetaCode } from "./beta-helpers";
interface Fixture {
  page: LocalPage;
  document: Omit<LocalDocument, "update"> & { update: number[] };
}

test("1000 cached Pages, a 500-block document and 1000 Task Rows stay usable", async ({
  page,
  context,
}, testInfo) => {
  const name = `Scale ${Date.now()}`;
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
  await page.getByRole("button", { name: "계속하기", exact: true }).click();
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
  const workspaceId = new URL(page.url()).searchParams.get("workspace")!,
    rows: Fixture[] = [];
  for (let index = 0; index < 1000; index++) {
    const document = new Y.Doc(),
      id = crypto.randomUUID(),
      kind = index === 999 ? "database" : "document",
      title = `Benchmark ${String(index).padStart(4, "0")}`;
    document.getText("title").insert(0, title);
    if (index === 998) {
      const blocks = Array.from({ length: 500 }, (_, block) => {
        const paragraph = new Y.XmlElement("paragraph"),
          text = new Y.XmlText();
        text.insert(0, `Performance block ${block}`);
        paragraph.insert(0, [text]);
        return paragraph;
      });
      document.getXmlFragment("content").insert(0, blocks);
    }
    if (index === 999)
      document.transact(() => {
        for (let task = 0; task < 1000; task++)
          createTaskRow(document, `Scale task ${task}`);
      });
    rows.push({
      page: {
        id,
        workspaceId,
        parentId: null,
        kind,
        title,
        revision: 0,
        deletedAt: null,
        createdAt: new Date().toISOString(),
        isInbox: false,
        role: "owner",
      },
      document: {
        id,
        workspaceId,
        ...getDocumentProjection(document),
        update: Array.from(Y.encodeStateAsUpdate(document)),
        generation: 0,
        committedGeneration: 0,
        state: "saved",
        updatedAt: index,
      },
    });
    document.destroy();
  }
  await context.setOffline(true);
  await expect(
    page.getByRole("button", { name: "Offline", exact: true }),
  ).toBeVisible();
  await page.evaluate(async (fixtures) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("zeronote-alpha");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(["pages", "documents"], "readwrite");
        for (const fixture of fixtures) {
          tx.objectStore("pages").put(fixture.page);
          tx.objectStore("documents").put({
            ...fixture.document,
            update: new Uint8Array(fixture.document.update),
          });
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  }, rows);
  await page.reload();
  await expect(page.getByLabel("Page 제목")).toHaveValue("시작하기");
  const sidebar = page.getByRole("complementary", { name: "Workspace 탐색" });
  await expect(
    sidebar.getByRole("button", { name: "Benchmark 0998", exact: true }),
  ).toBeVisible();
  const cachedPageButton = sidebar.getByRole("button", {
    name: "Benchmark 0998",
    exact: true,
  });
  await cachedPageButton.evaluate((button) => {
    button.addEventListener(
      "click",
      () => performance.mark("cached-page-start"),
      { once: true },
    );
    const observer = new MutationObserver(() => {
      const title = document.querySelector<HTMLInputElement>(
        '[aria-label="Page 제목"]',
      );
      const editor = document.querySelector('[aria-label="문서 본문"]');
      if (
        title?.value === "Benchmark 0998" &&
        editor?.textContent?.includes("Performance block 499")
      ) {
        observer.disconnect();
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            performance.mark("cached-page-end");
            performance.measure(
              "cached-page-render",
              "cached-page-start",
              "cached-page-end",
            );
          }),
        );
      }
    });
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
    });
  });
  const opened = performance.now();
  await cachedPageButton.click();
  await expect(page.getByRole("textbox", { name: "문서 본문" })).toContainText(
    "Performance block 499",
  );
  const automationOpenMs = performance.now() - opened;
  await expect
    .poll(() =>
      page.evaluate(
        () => performance.getEntriesByName("cached-page-render").length,
      ),
    )
    .toBe(1);
  const openMs = await page.evaluate(
    () => performance.getEntriesByName("cached-page-render")[0]!.duration,
  );
  expect(openMs).toBeLessThan(1000);
  await page.getByRole("button", { name: /^Search/ }).click();
  await page.evaluate(() => {
    const input = document.querySelector<HTMLInputElement>(
      '[aria-label="Workspace 검색"]',
    );
    input?.addEventListener(
      "input",
      () => performance.mark("local-search-start"),
      { once: true },
    );
    const observer = new MutationObserver(() => {
      const titles = Array.from(
        document.querySelectorAll(".search-results strong"),
      ).map((element) => element.textContent);
      if (titles.length === 1 && titles[0] === "Benchmark 0729") {
        observer.disconnect();
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            performance.mark("local-search-end");
            performance.measure(
              "local-search-render",
              "local-search-start",
              "local-search-end",
            );
          }),
        );
      }
    });
    observer.observe(document.querySelector(".search-results")!, {
      subtree: true,
      childList: true,
      characterData: true,
    });
  });
  const started = performance.now();
  await page.getByLabel("Workspace 검색").fill("Benchmark 0729");
  await expect(
    page.getByRole("dialog").getByRole("button", { name: /Benchmark 0729/ }),
  ).toBeVisible();
  const automationSearchMs = performance.now() - started;
  await expect
    .poll(() =>
      page.evaluate(
        () => performance.getEntriesByName("local-search-render").length,
      ),
    )
    .toBe(1);
  const searchMs = await page.evaluate(
    () => performance.getEntriesByName("local-search-render")[0]!.duration,
  );
  expect(searchMs).toBeLessThan(200);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "닫기", exact: true })
    .click();
  await sidebar
    .getByRole("button", { name: "Benchmark 0999", exact: true })
    .click();
  await expect(
    page.getByText("1000개 Task · 0개 완료", { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Task 이름").first()).toHaveValue(
    "Scale task 0",
  );
  await writeFile(
    testInfo.outputPath("performance.json"),
    JSON.stringify({
      pages: 1000,
      blocks: 500,
      tasks: 1000,
      cachedPageOpenMs: openMs,
      automationOpenMs,
      localSearchMs: searchMs,
      automationSearchMs,
    }),
  );
  await testInfo.attach("performance.json", {
    body: JSON.stringify({
      pages: 1000,
      blocks: 500,
      tasks: 1000,
      cachedPageOpenMs: openMs,
      automationOpenMs,
      localSearchMs: searchMs,
      automationSearchMs,
    }),
    contentType: "application/json",
  });
  await context.setOffline(false);
  await page.request.delete(
    `${process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3002"}/v1/workspaces/${workspaceId}`,
    {
      headers: {
        origin: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3002",
      },
      data: { name },
    },
  );
});
