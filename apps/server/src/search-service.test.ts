import { afterEach, expect, it, vi } from "vitest";
import {
  parseSearchQuery,
  SearchRequestSchema,
  type Metadata,
  type KnowledgeProjection,
} from "@zeronote/shared";
import { Repository } from "./database/repository";
import { AccessService } from "./services";
import { SearchService } from "./search-service";
import { env } from "./env";

const repositories: Repository[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const repository of repositories.splice(0)) await repository.close();
});
function fixture() {
  const repository = new Repository(env.DATABASE_URL),
    access = new AccessService(repository),
    service = new SearchService(repository, access);
  repositories.push(repository);
  return { repository, access, service };
}
function input(query = "") {
  return SearchRequestSchema.parse({
    query: parseSearchQuery(query),
    workspaceId: null,
  });
}
const empty: Metadata = {
  pages: [],
  workspaces: [],
  identities: [],
  roles: {},
};
it("limits concurrent requests and releases capacity after success and failure", async () => {
  const { access, service } = fixture();
  let release!: (value: Metadata) => void;
  const waiting = new Promise<Metadata>((resolve) => {
    release = resolve;
  });
  const metadata = vi.spyOn(access, "metadata").mockReturnValue(waiting);
  const first = service.search("device", input()),
    second = service.search("device", input());
  await expect(service.search("device", input())).rejects.toMatchObject({
    status: 429,
  });
  release(empty);
  expect(
    (await Promise.all([first, second])).map((result) => result.hits),
  ).toEqual([[], []]);
  metadata.mockRejectedValueOnce(new Error("Database unavailable"));
  await expect(service.search("device", input())).rejects.toThrow(
    "Database unavailable",
  );
  metadata.mockResolvedValue(empty);
  expect((await service.search("device", input())).searchedPages).toBe(0);
});
it("rejects an oversized batch without partial results, and applies Metadata filters before body reads", async () => {
  const { repository, access, service } = fixture(),
    workspaceId = crypto.randomUUID(),
    createdAt = new Date().toISOString();
  const pages: Metadata["pages"] = Array.from({ length: 8 }, () => ({
    id: crypto.randomUUID(),
    workspaceId,
    parentId: null,
    kind: "database",
    title: "Large DB",
    revision: 0,
    deletedAt: null,
    createdAt,
    isInbox: false,
  }));
  vi.spyOn(access, "metadata").mockResolvedValue({
    ...empty,
    pages,
    workspaces: [
      {
        id: workspaceId,
        name: "Large",
        ownerIdentityId: crypto.randomUUID(),
        createdAt,
      },
    ],
    roles: Object.fromEntries(pages.map((page) => [page.id, "owner" as const])),
  });
  const projection: KnowledgeProjection = {
    version: 1,
    title: "Large DB",
    body: "x".repeat(3 * 1024 * 1024),
    tags: [],
    links: [],
    properties: [],
    rows: [],
    mode: "generic",
  };
  const list = vi
    .spyOn(repository.search, "list")
    .mockImplementation(async (ids) =>
      ids.map((pageId) => ({ pageId, projection, updatedAt: createdAt })),
    );
  await expect(service.search("device", input())).rejects.toMatchObject({
    status: 422,
  });
  list.mockClear();
  expect((await service.search("device", input("type:page"))).hits).toEqual([]);
  expect(list).not.toHaveBeenCalled();
});
it("returns only authorized Database properties and propagates access failures", async () => {
  const { access, service, repository } = fixture();
  vi.spyOn(access, "page").mockRejectedValueOnce(
    new Error("Permission denied"),
  );
  await expect(
    service.properties("device", crypto.randomUUID()),
  ).rejects.toThrow("Permission denied");
  const page = {
    id: crypto.randomUUID(),
    workspaceId: crypto.randomUUID(),
    title: "Document",
    kind: "document" as const,
    createdAt: new Date().toISOString(),
    parentId: null,
    deletedAt: null,
    revision: 0,
    isInbox: false,
  };
  vi.mocked(access.page).mockResolvedValue({
    page,
    role: "viewer",
    identityId: crypto.randomUUID(),
    name: "Viewer",
  });
  await expect(service.properties("device", page.id)).rejects.toMatchObject({
    status: 400,
  });
  vi.mocked(access.page).mockResolvedValue({
    page: { ...page, kind: "database" },
    role: "viewer",
    identityId: crypto.randomUUID(),
    name: "Viewer",
  });
  vi.spyOn(repository.search, "list").mockResolvedValue([]);
  expect(await service.properties("device", page.id)).toEqual([]);
});
