import {
  canEdit,
  createKnowledgeView,
  getKnowledgeHead,
  PageSchema,
  type KnowledgeRequest,
  type KnowledgeResponse,
  type KnowledgeSource,
  type KnowledgeHead,
} from "@zeronote/shared";
import type { Repository } from "./database/repository";
import { AccessService, DomainError } from "./services";

const KNOWLEDGE_BATCH_SIZE = 8;
const MAX_KNOWLEDGE_SOURCE_BYTES = 16 * 1024 * 1024;
const MAX_CONCURRENT_KNOWLEDGE_REQUESTS = 2;
export class KnowledgeService {
  private active = 0;
  constructor(
    readonly repository: Repository,
    readonly access: AccessService,
  ) {}
  async view(
    deviceId: string,
    input: KnowledgeRequest,
  ): Promise<KnowledgeResponse> {
    if (this.active >= MAX_CONCURRENT_KNOWLEDGE_REQUESTS)
      throw new DomainError(429, "다른 연결 조회가 끝난 뒤 다시 시도해주세요.");
    this.active++;
    try {
      return await this.loadView(deviceId, input);
    } finally {
      this.active--;
    }
  }
  private async loadView(
    deviceId: string,
    input: KnowledgeRequest,
  ): Promise<KnowledgeResponse> {
    await this.access.page(deviceId, input.pageId);
    const metadata = await this.access.metadata(deviceId),
      active = metadata.pages.filter(
        (page) => !page.deletedAt && !page.ancestorTrashed,
      ),
      heads = new Map<string, KnowledgeHead>(),
      titles = new Map<string, string>();
    const allowed = new Set(active.map((page) => page.id));
    for (const overlay of input.overlays)
      if (
        allowed.has(overlay.pageId) &&
        canEdit(metadata.roles[overlay.pageId]!)
      ) {
        heads.set(overlay.pageId, getKnowledgeHead(overlay.projection));
        titles.set(
          overlay.pageId,
          PageSchema.shape.title.parse(overlay.projection.title) || "제목 없음",
        );
      }
    const pending = active.filter((page) => !heads.has(page.id));
    let bytes = [...heads.values()].reduce(
      (total, head) => total + Buffer.byteLength(JSON.stringify(head)),
      0,
    );
    for (
      let offset = 0;
      offset < pending.length;
      offset += KNOWLEDGE_BATCH_SIZE
    ) {
      const ids = pending
        .slice(offset, offset + KNOWLEDGE_BATCH_SIZE)
        .map((page) => page.id);
      const batch = await this.repository.search.heads(ids);
      for (const item of batch) {
        if (!ids.includes(item.pageId) || heads.has(item.pageId)) continue;
        bytes += Buffer.byteLength(JSON.stringify(item.head));
        if (bytes > MAX_KNOWLEDGE_SOURCE_BYTES)
          throw new DomainError(
            422,
            "연결 데이터가 큽니다. 이 기기의 연결을 먼저 확인해주세요.",
          );
        heads.set(item.pageId, item.head);
      }
    }
    const sources: KnowledgeSource[] = metadata.pages.map((page) => ({
      page: {
        id: page.id,
        workspaceId: page.workspaceId,
        title: titles.get(page.id) ?? page.title,
        kind: page.kind,
        trashed: !!page.deletedAt || !!page.ancestorTrashed,
      },
      head: heads.get(page.id),
    }));
    return createKnowledgeView(sources, input);
  }
}
