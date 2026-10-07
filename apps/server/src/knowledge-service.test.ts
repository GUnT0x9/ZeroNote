import { afterEach, expect, it, vi } from "vitest";
import {
  KnowledgeRequestSchema,
  getKnowledgeHead,
  type Metadata,
  type KnowledgeProjection,
} from "@zeronote/shared";
import { Repository } from "./database/repository";
import { KnowledgeService } from "./knowledge-service";
import { AccessService } from "./services";
import { env } from "./env";

const repositories: Repository[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const repository of repositories.splice(0)) await repository.close();
});
function fixture(count = 1) {
  const repository = new Repository(env.DATABASE_URL),
    access = new AccessService(repository),
    service = new KnowledgeService(repository, access),
    workspaceId = crypto.randomUUID(),
    createdAt = new Date().toISOString();
  repositories.push(repository);
  const pages: Metadata["pages"] = Array.from({ length: count }, () => ({
    id: crypto.randomUUID(),
    workspaceId,
    title: "Page",
    kind: "document",
    parentId: null,
    revision: 0,
    deletedAt: null,
    createdAt,
    isInbox: false,
  }));
  const metadata: Metadata = {
    pages,
    workspaces: [],
    identities: [],
    roles: Object.fromEntries(pages.map((page) => [page.id, "owner"])),
  };
  vi.spyOn(access, "page").mockResolvedValue({
    page: pages[0]!,
    role: "owner",
    identityId: crypto.randomUUID(),
    name: "Owner",
  });
  vi.spyOn(access, "metadata").mockResolvedValue(metadata);
  vi.spyOn(repository.search, "heads").mockResolvedValue([]);
  return {
    repository,
    access,
    service,
    metadata,
    input: KnowledgeRequestSchema.parse({ pageId: pages[0]!.id }),
  };
}
it("limits concurrent requests and releases capacity after successful and failed reads", async () => {
  const { access, service, metadata, input } = fixture();
  let release!: (value: Metadata) => void;
  vi.mocked(access.metadata).mockReturnValue(
    new Promise<Metadata>((resolve) => {
      release = resolve;
    }),
  );
  const first = service.view("device", input),
    second = service.view("device", input);
  await expect(service.view("device", input)).rejects.toMatchObject({
    status: 429,
  });
  release(metadata);
  expect(
    (await Promise.all([first, second])).map((entry) => entry.nodes.length),
  ).toEqual([1, 1]);
  vi.mocked(access.metadata).mockRejectedValueOnce(new Error("Read failed"));
  await expect(service.view("device", input)).rejects.toThrow("Read failed");
  vi.mocked(access.metadata).mockResolvedValue(metadata);
  expect((await service.view("device", input)).root?.id).toBe(input.pageId);
});
it("checks root access before Index reads, bounds memory and never reads a Trashed source", async () => {
  const { repository, access, service, metadata, input } = fixture(8);
  vi.mocked(access.page).mockRejectedValueOnce(new Error("Access revoked"));
  await expect(service.view("device", input)).rejects.toThrow("Access revoked");
  expect(repository.search.heads).not.toHaveBeenCalled();
  vi.mocked(repository.search.heads).mockImplementation(async (ids) =>
    ids.map((pageId) => ({
      pageId,
      head: {
        links: [],
        rows: [],
        tags: [],
        words: ["x".repeat(3 * 1024 * 1024)],
      },
    })),
  );
  await expect(service.view("device", input)).rejects.toMatchObject({
    status: 422,
  });
  vi.mocked(repository.search.heads).mockResolvedValue([]).mockClear();
  metadata.pages[1]!.ancestorTrashed = true;
  await service.view("device", input);
  expect(vi.mocked(repository.search.heads).mock.calls[0]?.[0]).not.toContain(
    metadata.pages[1]!.id,
  );
});
it("accepts only editable temporary heads and returns current committed scope without persisting overlays", async () => {
  const { repository, access, service, metadata, input } = fixture(2),
    target = metadata.pages[1]!,
    root = metadata.pages[0]!;
  const projection: KnowledgeProjection = {
    version: 1,
    title: "Temporary",
    body: "",
    mode: "task",
    properties: [],
    rows: [],
    tags: ["tag"],
    links: [{ pageId: target.id, kind: "mention" }],
  };
  const committed = [
    { pageId: root.id, head: getKnowledgeHead({ ...projection, links: [] }) },
  ];
  vi.mocked(repository.search.heads).mockImplementation(async (ids) =>
    committed.filter((item) => ids.includes(item.pageId)),
  );
  input.overlays = [{ pageId: root.id, projection }];
  expect((await service.view("device", input)).neighborCount).toBe(1);
  metadata.roles[root.id] = "viewer";
  vi.mocked(access.metadata).mockResolvedValue(metadata);
  expect((await service.view("device", input)).neighborCount).toBe(0);
  expect(repository.search.heads).toHaveBeenCalled();
});
