import {
  canEdit,
  matchesSearchMetadataFilters,
  compareSearchHits,
  createSearchEngine,
  type SearchRequest,
  type SearchResponse,
  type SearchSource,
  type Metadata,
  type KnowledgeProjection,
} from "@zeronote/shared";
import type { Repository } from "./database/repository";
import { AccessService, DomainError } from "./services";

const SEARCH_BATCH_SIZE = 8,
  MAX_SEARCH_SOURCE_BYTES = 16 * 1024 * 1024;
const MAX_CONCURRENT_SEARCHES = 2;
export class SearchService {
  private active = 0;
  constructor(
    readonly repository: Repository,
    readonly access: AccessService,
  ) {}
  async search(
    deviceId: string,
    input: SearchRequest,
  ): Promise<SearchResponse> {
    if (this.active >= MAX_CONCURRENT_SEARCHES)
      throw new DomainError(429, "다른 검색이 끝난 뒤 다시 시도해주세요.");
    this.active++;
    try {
      return await this.runSearch(deviceId, input);
    } finally {
      this.active--;
    }
  }
  async properties(deviceId: string, pageId: string) {
    const { page } = await this.access.page(deviceId, pageId);
    if (page.kind !== "database")
      throw new DomainError(400, "Database를 선택해주세요.");
    return (
      (await this.repository.search.list([pageId]))[0]?.projection.properties ??
      []
    );
  }
  private async runSearch(
    deviceId: string,
    input: SearchRequest,
  ): Promise<SearchResponse> {
    const metadata = await this.access.metadata(deviceId);
    const allowed = metadata.pages.filter(
      (page) => !page.deletedAt && !page.ancestorTrashed,
    );
    const byId = new Map(allowed.map((page) => [page.id, page]));
    const overlays = new Map<
      string,
      { projection: KnowledgeProjection; updatedAt: string }
    >();
    for (const overlay of input.overlays) {
      // A revoked local copy cannot enter a server result or dependency computation.
      if (byId.has(overlay.pageId) && canEdit(metadata.roles[overlay.pageId]!))
        overlays.set(overlay.pageId, overlay);
    }
    const candidates = allowed.filter(
      (page) =>
        (!input.workspaceId || page.workspaceId === input.workspaceId) &&
        matchesSearchMetadataFilters(
          {
            page,
            updatedAt: new Date(page.createdAt).toISOString(),
            workspaceName:
              metadata.workspaces.find(
                (workspace) => workspace.id === page.workspaceId,
              )?.name ?? "Workspace",
          },
          input.query,
        ),
    );
    const response: SearchResponse = {
      hits: [],
      searchedPages: 0,
      unavailableProperties: 0,
    };
    for (
      let offset = 0;
      offset < candidates.length;
      offset += SEARCH_BATCH_SIZE
    ) {
      const ids = candidates
        .slice(offset, offset + SEARCH_BATCH_SIZE)
        .map((page) => page.id);
      const sources = await this.loadSources(ids, metadata, overlays);
      const files = await this.repository.attachments.searchNames(
        sources
          .filter((source) => source.page.kind === "database")
          .map((source) => source.page.id),
      );
      const names = new Map(
        files.map((file) => [`${file.pageId}:${file.id}`, file.name]),
      );
      const identities = new Map(
        metadata.identities.map((identity) => [
          `${identity.workspaceId}:${identity.id}`,
          identity.name,
        ]),
      );
      const engine = createSearchEngine(sources, {
        fileName: (pageId, id) => names.get(`${pageId}:${id}`),
        personName: (workspaceId, id) => identities.get(`${workspaceId}:${id}`),
      });
      try {
        const batch = engine.search(input.query, input.limit, ids);
        response.hits = [...response.hits, ...batch.hits]
          .sort(compareSearchHits)
          .slice(0, input.limit);
        response.searchedPages += batch.searchedPages;
        response.unavailableProperties += batch.unavailableProperties;
      } finally {
        engine.dispose();
      }
    }
    return response;
  }
  private async loadSources(
    ids: string[],
    metadata: Metadata,
    overlays: Map<
      string,
      { projection: KnowledgeProjection; updatedAt: string }
    >,
  ): Promise<SearchSource[]> {
    const allowed = new Map(
      metadata.pages
        .filter((page) => !page.deletedAt && !page.ancestorTrashed)
        .map((page) => [page.id, page]),
    );
    const sources = new Map<string, SearchSource>();
    let pending = ids,
      bytes = 0;
    while (pending.length) {
      const batch = pending.slice(0, SEARCH_BATCH_SIZE);
      pending = pending.slice(SEARCH_BATCH_SIZE);
      const stored = new Map(
        (
          await this.repository.search.list(
            batch.filter((id) => !overlays.has(id)),
          )
        ).map((source) => [source.pageId, source]),
      );
      for (const id of batch) {
        const page = allowed.get(id);
        if (!page || sources.has(id)) continue;
        const value = overlays.get(id) ?? stored.get(id);
        bytes += value
          ? Buffer.byteLength(JSON.stringify(value.projection))
          : 0;
        if (bytes > MAX_SEARCH_SOURCE_BYTES)
          throw new DomainError(
            422,
            "검색할 데이터가 큽니다. Workspace나 Database 조건으로 범위를 좁혀주세요.",
          );
        sources.set(id, {
          page,
          projection: value?.projection,
          updatedAt: new Date(value?.updatedAt ?? page.createdAt).toISOString(),
          workspaceName:
            metadata.workspaces.find(
              (workspace) => workspace.id === page.workspaceId,
            )?.name ?? "Workspace",
        });
        for (const property of value?.projection.properties ?? []) {
          const targetId = property.relation?.databaseId,
            target = targetId ? allowed.get(targetId) : undefined;
          if (
            target &&
            target.kind === "database" &&
            target.workspaceId === page.workspaceId &&
            !sources.has(target.id) &&
            !pending.includes(target.id)
          )
            pending.push(target.id);
        }
      }
    }
    return [...sources.values()];
  }
}
