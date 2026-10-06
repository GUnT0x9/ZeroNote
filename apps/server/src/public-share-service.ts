import { PublicShareInputSchema, PublicOpenSchema } from "@zeronote/shared";
import type { Repository } from "./database/repository";
import type { AccessService } from "./services";
export class PublicShareService {
  constructor(
    readonly repository: Repository,
    readonly access: AccessService,
  ) {}
  async list(deviceId: string, workspaceId: string) {
    await this.access.workspaceOwner(deviceId, workspaceId);
    return this.repository.publicShares.owned(workspaceId);
  }
  async create(deviceId: string, workspaceId: string, input: unknown) {
    await this.access.workspaceOwner(deviceId, workspaceId);
    return this.repository.publicShares.create(
      deviceId,
      workspaceId,
      PublicShareInputSchema.parse(input),
    );
  }
  async revoke(deviceId: string, workspaceId: string, id: string) {
    await this.access.workspaceOwner(deviceId, workspaceId);
    return this.repository.publicShares.revoke(workspaceId, id);
  }
  open(id: string, input: unknown) {
    return this.repository.publicShares.open(id, PublicOpenSchema.parse(input));
  }
}
