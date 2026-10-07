import type { CommentInput } from "@zeronote/shared";
import type { Repository } from "./database/repository";
import type { AccessService } from "./services";

export class CommentService {
  constructor(
    readonly repository: Repository,
    readonly access: AccessService,
  ) {}

  async list(deviceId: string, pageId: string, rowId: string | null = null) {
    await this.access.page(deviceId, pageId);
    await this.repository.comments.assertRow(pageId, rowId);
    return this.repository.comments.list(pageId, rowId);
  }

  async create(deviceId: string, input: CommentInput): Promise<void> {
    await this.repository.comments.create(input, (executor) =>
      this.access.page(deviceId, input.pageId, false, executor),
    );
  }

  async resolve(
    deviceId: string,
    pageId: string,
    id: string,
    rowId: string | null,
    resolved: boolean,
  ): Promise<void> {
    await this.repository.comments.resolve(
      pageId,
      id,
      rowId,
      resolved,
      (executor) => this.access.page(deviceId, pageId, false, executor),
    );
  }
}
