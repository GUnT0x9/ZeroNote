import type {
  GroupGrantInput,
  MemberGroupInput,
  MemberGrantInput,
  MemberRevision,
  MemberOperation,
  MemberProfileInput,
  MemberProfile,
} from "@zeronote/shared";
import type { Executor, Repository } from "./database/repository";
import type { MemberChange } from "./database/member-store";
import type { AccessService } from "./services";
import { DomainError } from "./errors";

export class MemberService {
  constructor(
    readonly repository: Repository,
    readonly access: AccessService,
    readonly invalidate: (pageId: string) => void,
  ) {}
  private owner(deviceId: string, workspaceId: string) {
    return (tx: Executor) =>
      this.access.workspaceOwner(deviceId, workspaceId, tx);
  }
  private async changed(workspaceId: string, action: Promise<MemberChange>) {
    const result = await action;
    for (const page of await this.repository.listPages(workspaceId))
      this.invalidate(page.id);
    return result;
  }
  async list(deviceId: string, workspaceId: string) {
    return this.repository.members.list(
      workspaceId,
      this.owner(deviceId, workspaceId),
    );
  }
  async revokeDevice(deviceId: string, workspaceId: string, target: string) {
    await this.repository.members.revokeDevice(
      deviceId,
      workspaceId,
      target,
      this.owner(deviceId, workspaceId),
    );
    return this.changed(workspaceId, Promise.resolve({ id: target }));
  }
  async profile(deviceId: string, workspaceId: string): Promise<MemberProfile> {
    const member = await this.access.workspaceMember(deviceId, workspaceId);
    return {
      id: member.identityId,
      name: member.name,
      role: member.identityId === member.ownerIdentityId ? "owner" : "member",
    };
  }
  async rename(
    deviceId: string,
    workspaceId: string,
    input: MemberProfileInput,
  ) {
    return this.changed(
      workspaceId,
      this.repository.members.rename(deviceId, workspaceId, input, (tx) =>
        this.access.workspaceMember(deviceId, workspaceId, tx),
      ),
    );
  }
  async saveGroup(
    deviceId: string,
    workspaceId: string,
    id: string,
    input: MemberGroupInput,
  ) {
    return this.changed(
      workspaceId,
      this.repository.members.saveGroup(
        deviceId,
        workspaceId,
        id,
        input,
        this.owner(deviceId, workspaceId),
      ),
    );
  }
  async deleteGroup(
    deviceId: string,
    workspaceId: string,
    id: string,
    input: MemberRevision,
  ) {
    return this.changed(
      workspaceId,
      this.repository.members.deleteGroup(
        deviceId,
        workspaceId,
        id,
        input,
        this.owner(deviceId, workspaceId),
      ),
    );
  }
  async saveGroupGrant(
    deviceId: string,
    workspaceId: string,
    input: GroupGrantInput,
  ) {
    const authorize = async (tx: Executor) => {
      const owner = await this.access.workspaceOwner(deviceId, workspaceId, tx);
      await this.repository.documents.lock(input.pageId, tx);
      const { page } = await this.access.page(
        deviceId,
        input.pageId,
        false,
        tx,
      );
      if (page.workspaceId !== workspaceId)
        throw new DomainError(
          400,
          "다른 Workspace의 Page는 공유할 수 없습니다.",
        );
      return owner;
    };
    return this.changed(
      workspaceId,
      this.repository.members.saveGroupGrant(
        deviceId,
        workspaceId,
        input,
        authorize,
      ),
    );
  }
  async revokeGroupGrant(
    deviceId: string,
    workspaceId: string,
    id: string,
    input: MemberRevision,
  ) {
    return this.changed(
      workspaceId,
      this.repository.members.revokeGroupGrant(
        deviceId,
        workspaceId,
        id,
        input,
        this.owner(deviceId, workspaceId),
      ),
    );
  }
  async changeGrant(
    deviceId: string,
    workspaceId: string,
    identityId: string,
    id: string,
    input: MemberGrantInput | MemberRevision,
  ) {
    return this.changed(
      workspaceId,
      this.repository.members.changeGrant(
        deviceId,
        workspaceId,
        identityId,
        id,
        input,
        this.owner(deviceId, workspaceId),
      ),
    );
  }
  async revokeMember(
    deviceId: string,
    workspaceId: string,
    id: string,
    input: MemberOperation,
  ) {
    return this.changed(
      workspaceId,
      this.repository.members.revokeMember(
        deviceId,
        workspaceId,
        id,
        input,
        this.owner(deviceId, workspaceId),
      ),
    );
  }
}
