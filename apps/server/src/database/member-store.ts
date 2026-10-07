import { sql } from "drizzle-orm";
import {
  MAX_MEMBER_GROUPS,
  sha256Hex,
  type MemberGroup,
  type MemberGroupInput,
  type MemberGrant,
  type MemberGrantInput,
  type GroupGrant,
  type GroupGrantInput,
  type MemberOperation,
  type MemberProfileInput,
  type MemberRevision,
  type WorkspaceMembers,
} from "@zeronote/shared";
import { DomainError } from "../errors";
import type { Repository, Executor, MembershipRecord } from "./repository";

import { CONTENT_WRITE_LOCK_ID } from "./locks";
type Authorize = (tx: Executor) => Promise<MembershipRecord>;
export interface MemberChange {
  id: string;
  revision?: number;
}

export class MemberStore {
  constructor(readonly repository: Repository) {}

  async revokeDevice(
    deviceId: string,
    workspaceId: string,
    target: string,
    authorize: Authorize,
  ): Promise<void> {
    await this.repository.database.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(${CONTENT_WRITE_LOCK_ID})`,
      );
      await authorize(tx);
      if (target === deviceId)
        throw new DomainError(
          400,
          "현재 기기는 다른 승인된 기기에서 철회해주세요.",
        );
      await tx.execute(
        sql`UPDATE memberships SET revoked_at=now() WHERE workspace_id=${workspaceId} AND device_id=${target}`,
      );
    });
  }

  async list(
    workspaceId: string,
    authorize: Authorize,
  ): Promise<WorkspaceMembers> {
    return this.repository.database.transaction(async (tx) => {
      const own = await authorize(tx);
      const identities = await this.repository.query<{
        id: string;
        name: string;
      }>(
        sql`SELECT id,name FROM identities WHERE workspace_id=${workspaceId} ORDER BY name,id`,
        tx,
      );
      const devices = await this.repository.query<{
        id: string;
        identityId: string;
        name: string;
        revoked: boolean;
      }>(
        sql`SELECT d.id,m.identity_id AS "identityId",d.name,m.revoked_at IS NOT NULL AS revoked FROM memberships m JOIN devices d ON d.id=m.device_id WHERE m.workspace_id=${workspaceId} ORDER BY d.created_at,d.id`,
        tx,
      );
      const grants = await this.repository.query<MemberGrant>(
        sql`SELECT id,identity_id AS "identityId",page_id AS "pageId",role,include_descendants AS "includeDescendants",revision,revoked_at IS NOT NULL AS revoked FROM grants WHERE workspace_id=${workspaceId} ORDER BY id`,
        tx,
      );
      const groups = await this.listGroups(workspaceId, tx);
      const groupGrants = await this.repository.query<GroupGrant>(
        sql`SELECT g.id,g.group_id AS "groupId",g.page_id AS "pageId",g.role,g.include_descendants AS "includeDescendants",g.revision,g.revoked_at IS NOT NULL AS revoked FROM member_group_grants g JOIN member_groups m ON m.id=g.group_id WHERE m.workspace_id=${workspaceId} AND m.deleted_at IS NULL ORDER BY g.id`,
        tx,
      );
      return {
        ownIdentityId: own.identityId,
        groups,
        groupGrants,
        members: identities.map((identity) => {
          const theirDevices = devices.filter(
            (d) => d.identityId === identity.id,
          );
          return {
            ...identity,
            owner: identity.id === own.ownerIdentityId,
            revoked: !theirDevices.some((d) => !d.revoked),
            devices: theirDevices.map(
              ({ identityId: _identityId, ...device }) => device,
            ),
            grants: grants.filter((g) => g.identityId === identity.id),
            groupIds: groups
              .filter((g) => g.memberIds.includes(identity.id))
              .map((g) => g.id),
          };
        }),
      };
    });
  }

  private async listGroups(
    workspaceId: string,
    tx: Executor,
  ): Promise<MemberGroup[]> {
    return this.repository.query<MemberGroup>(
      sql`SELECT g.id,g.workspace_id AS "workspaceId",g.name,g.revision,COALESCE(array_agg(m.identity_id ORDER BY m.identity_id) FILTER(WHERE m.identity_id IS NOT NULL AND EXISTS(SELECT 1 FROM memberships a WHERE a.identity_id=m.identity_id AND a.workspace_id=g.workspace_id AND a.revoked_at IS NULL)),'{}'::uuid[]) AS "memberIds" FROM member_groups g LEFT JOIN member_group_members m ON m.group_id=g.id WHERE g.workspace_id=${workspaceId} AND g.deleted_at IS NULL GROUP BY g.id ORDER BY g.name,g.id`,
      tx,
    );
  }

  private async write(
    deviceId: string,
    workspaceId: string,
    kind: string,
    target: string,
    input: MemberOperation,
    authorize: Authorize,
    action: (tx: Executor, member: MembershipRecord) => Promise<MemberChange>,
  ): Promise<MemberChange> {
    const hash = await sha256Hex(
      JSON.stringify([workspaceId, deviceId, kind, target, input]),
    );
    return this.repository.database.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(${CONTENT_WRITE_LOCK_ID})`,
      );
      await tx.execute(
        sql`SELECT id FROM workspaces WHERE id=${workspaceId} FOR UPDATE`,
      );
      const member = await authorize(tx);
      const prior = await this.repository.query<{
        workspaceId: string;
        deviceId: string;
        hash: string;
        result: MemberChange;
      }>(
        sql`SELECT workspace_id AS "workspaceId",device_id AS "deviceId",payload_hash AS hash,result FROM member_operations WHERE operation_id=${input.operationId}`,
        tx,
      );
      if (prior[0]) {
        if (
          prior[0].workspaceId !== workspaceId ||
          prior[0].deviceId !== deviceId ||
          prior[0].hash !== hash
        )
          throw new DomainError(
            409,
            "Operation ID가 다른 멤버 변경에 사용됐습니다.",
          );
        return prior[0].result;
      }
      const result = await action(tx, member);
      await tx.execute(
        sql`INSERT INTO member_operations(operation_id,workspace_id,device_id,payload_hash,result) VALUES(${input.operationId},${workspaceId},${deviceId},${hash},${JSON.stringify(result)}::jsonb)`,
      );
      return result;
    });
  }

  private assertRevision(actual: number, expected: number): void {
    if (actual !== expected)
      throw new DomainError(
        409,
        "다른 기기에서 변경했습니다. 최신 상태를 확인하고 다시 적용해주세요.",
      );
  }

  private async group(workspaceId: string, groupId: string, tx: Executor) {
    const group = (
      await this.repository.query<{
        id: string;
        revision: number;
        deleted: boolean;
      }>(
        sql`SELECT id,revision,deleted_at IS NOT NULL AS deleted FROM member_groups WHERE id=${groupId} AND workspace_id=${workspaceId} FOR UPDATE`,
        tx,
      )
    )[0];
    if (!group || group.deleted)
      throw new DomainError(404, "그룹을 찾을 수 없습니다.");
    return group;
  }

  async saveGroup(
    deviceId: string,
    workspaceId: string,
    id: string,
    input: MemberGroupInput,
    authorize: Authorize,
  ) {
    const canonical = { ...input, memberIds: [...input.memberIds].sort() };
    return this.write(
      deviceId,
      workspaceId,
      "group-save",
      id,
      canonical,
      authorize,
      async (tx) => {
        const old = (
          await this.repository.query<{
            workspaceId: string;
            revision: number;
            deleted: boolean;
          }>(
            sql`SELECT workspace_id AS "workspaceId",revision,deleted_at IS NOT NULL AS deleted FROM member_groups WHERE id=${id} FOR UPDATE`,
            tx,
          )
        )[0];
        if (old && (old.workspaceId !== workspaceId || old.deleted))
          throw new DomainError(409, "사용할 수 없는 그룹 ID입니다.");
        this.assertRevision(old?.revision ?? 0, input.expectedRevision);
        await this.assertActiveMembers(workspaceId, input.memberIds, tx);
        if (!old) await this.assertGroupCapacity(workspaceId, tx);
        const revision = (old?.revision ?? 0) + 1;
        await tx.execute(
          sql`INSERT INTO member_groups(id,workspace_id,name,revision) VALUES(${id},${workspaceId},${input.name},${revision}) ON CONFLICT(id) DO UPDATE SET name=excluded.name,revision=excluded.revision`,
        );
        await tx.execute(
          sql`DELETE FROM member_group_members WHERE group_id=${id}`,
        );
        await tx.execute(
          sql`INSERT INTO member_group_members(group_id,identity_id) SELECT ${id}::uuid,value::uuid FROM jsonb_array_elements_text(${JSON.stringify(input.memberIds)}::jsonb)`,
        );
        return { id, revision };
      },
    );
  }

  private async assertActiveMembers(
    workspaceId: string,
    ids: string[],
    tx: Executor,
  ) {
    const members = await this.repository.query<{ id: string }>(
      sql`SELECT i.id FROM identities i WHERE i.workspace_id=${workspaceId} AND i.id IN(SELECT value::uuid FROM jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb)) AND EXISTS(SELECT 1 FROM memberships m WHERE m.identity_id=i.id AND m.workspace_id=${workspaceId} AND m.revoked_at IS NULL)`,
      tx,
    );
    if (members.length !== ids.length)
      throw new DomainError(
        400,
        "이 Workspace의 활성 멤버만 그룹에 추가할 수 있습니다.",
      );
  }

  private async assertGroupCapacity(workspaceId: string, tx: Executor) {
    const [row] = await this.repository.query<{ count: number }>(
      sql`SELECT count(*)::int AS count FROM member_groups WHERE workspace_id=${workspaceId} AND deleted_at IS NULL`,
      tx,
    );
    if ((row?.count ?? 0) >= MAX_MEMBER_GROUPS)
      throw new DomainError(
        409,
        `그룹은 최대 ${MAX_MEMBER_GROUPS}개까지 만들 수 있습니다.`,
      );
    await this.repository.documents.assertCapacity(tx);
  }

  async deleteGroup(
    deviceId: string,
    workspaceId: string,
    id: string,
    input: MemberRevision,
    authorize: Authorize,
  ) {
    return this.write(
      deviceId,
      workspaceId,
      "group-delete",
      id,
      input,
      authorize,
      async (tx) => {
        const group = await this.group(workspaceId, id, tx);
        this.assertRevision(group.revision, input.expectedRevision);
        await tx.execute(
          sql`UPDATE member_groups SET deleted_at=now(),revision=revision+1 WHERE id=${id}`,
        );
        await tx.execute(
          sql`UPDATE member_group_grants SET revoked_at=now(),revision=revision+1 WHERE group_id=${id} AND revoked_at IS NULL`,
        );
        return { id, revision: group.revision + 1 };
      },
    );
  }

  async saveGroupGrant(
    deviceId: string,
    workspaceId: string,
    input: GroupGrantInput,
    authorize: Authorize,
  ) {
    return this.write(
      deviceId,
      workspaceId,
      "group-grant",
      input.id,
      input,
      authorize,
      async (tx) => {
        await this.group(workspaceId, input.groupId, tx);
        const old = (
          await this.repository.query<{
            pageId: string;
            groupId: string;
            revision: number;
          }>(
            sql`SELECT page_id AS "pageId",group_id AS "groupId",revision FROM member_group_grants WHERE id=${input.id} FOR UPDATE`,
            tx,
          )
        )[0];
        if (
          old &&
          (old.pageId !== input.pageId || old.groupId !== input.groupId)
        )
          throw new DomainError(
            409,
            "공유 ID가 다른 Page나 그룹에 사용됐습니다.",
          );
        this.assertRevision(old?.revision ?? 0, input.expectedRevision);
        const duplicate = await this.repository.query(
          sql`SELECT id FROM member_group_grants WHERE page_id=${input.pageId} AND group_id=${input.groupId} AND id<>${input.id}`,
          tx,
        );
        if (duplicate.length)
          throw new DomainError(
            409,
            "그룹 공유가 이미 있습니다. 최신 상태를 확인해주세요.",
          );
        const revision = (old?.revision ?? 0) + 1;
        await tx.execute(
          sql`INSERT INTO member_group_grants(id,group_id,page_id,role,include_descendants,revision) VALUES(${input.id},${input.groupId},${input.pageId},${input.role},${input.includeDescendants},${revision}) ON CONFLICT(id) DO UPDATE SET role=excluded.role,include_descendants=excluded.include_descendants,revision=excluded.revision,revoked_at=NULL`,
        );
        return { id: input.id, revision };
      },
    );
  }

  async revokeGroupGrant(
    deviceId: string,
    workspaceId: string,
    id: string,
    input: MemberRevision,
    authorize: Authorize,
  ) {
    return this.write(
      deviceId,
      workspaceId,
      "group-grant-revoke",
      id,
      input,
      authorize,
      async (tx) => {
        const old = (
          await this.repository.query<{ revision: number }>(
            sql`SELECT g.revision FROM member_group_grants g JOIN member_groups m ON m.id=g.group_id WHERE g.id=${id} AND m.workspace_id=${workspaceId} AND m.deleted_at IS NULL FOR UPDATE OF g`,
            tx,
          )
        )[0];
        if (!old) throw new DomainError(404, "그룹 공유를 찾을 수 없습니다.");
        this.assertRevision(old.revision, input.expectedRevision);
        await tx.execute(
          sql`UPDATE member_group_grants SET revoked_at=now(),revision=revision+1 WHERE id=${id}`,
        );
        return { id, revision: old.revision + 1 };
      },
    );
  }

  async changeGrant(
    deviceId: string,
    workspaceId: string,
    identityId: string,
    id: string,
    input: MemberRevision | MemberGrantInput,
    authorize: Authorize,
  ) {
    const revoke = !("role" in input);
    return this.write(
      deviceId,
      workspaceId,
      revoke ? "grant-revoke" : "grant-edit",
      `${identityId}/${id}`,
      input,
      authorize,
      async (tx) => {
        const old = (
          await this.repository.query<{ revision: number; revoked: boolean }>(
            sql`SELECT revision,revoked_at IS NOT NULL AS revoked FROM grants WHERE id=${id} AND identity_id=${identityId} AND workspace_id=${workspaceId} FOR UPDATE`,
            tx,
          )
        )[0];
        if (!old) throw new DomainError(404, "접근 권한을 찾을 수 없습니다.");
        this.assertRevision(old.revision, input.expectedRevision);
        if (!revoke) {
          if (old.revoked)
            throw new DomainError(
              409,
              "철회된 접근은 새 Page 초대로 부여해주세요.",
            );
          await tx.execute(
            sql`UPDATE grants SET role=${input.role},include_descendants=${input.includeDescendants},revision=revision+1 WHERE id=${id}`,
          );
        } else
          await tx.execute(
            sql`UPDATE grants SET revoked_at=now(),revision=revision+1 WHERE id=${id}`,
          );
        return { id, revision: old.revision + 1 };
      },
    );
  }

  async revokeMember(
    deviceId: string,
    workspaceId: string,
    id: string,
    input: MemberOperation,
    authorize: Authorize,
  ) {
    return this.write(
      deviceId,
      workspaceId,
      "member-revoke",
      id,
      input,
      authorize,
      async (tx, owner) => {
        if (id === owner.ownerIdentityId)
          throw new DomainError(400, "Owner는 멤버에서 제거할 수 없습니다.");
        const found = await this.repository.query(
          sql`SELECT id FROM identities WHERE id=${id} AND workspace_id=${workspaceId}`,
          tx,
        );
        if (!found.length)
          throw new DomainError(404, "멤버를 찾을 수 없습니다.");
        await tx.execute(
          sql`UPDATE memberships SET revoked_at=now() WHERE workspace_id=${workspaceId} AND identity_id=${id}`,
        );
        await tx.execute(
          sql`UPDATE grants SET revoked_at=now(),revision=revision+1 WHERE workspace_id=${workspaceId} AND identity_id=${id} AND revoked_at IS NULL`,
        );
        await tx.execute(
          sql`UPDATE member_groups SET revision=revision+1 WHERE id IN(SELECT group_id FROM member_group_members WHERE identity_id=${id}) AND workspace_id=${workspaceId}`,
        );
        await tx.execute(
          sql`DELETE FROM member_group_members WHERE identity_id=${id}`,
        );
        return { id };
      },
    );
  }

  async rename(
    deviceId: string,
    workspaceId: string,
    input: MemberProfileInput,
    authorize: Authorize,
  ) {
    return this.write(
      deviceId,
      workspaceId,
      "profile-rename",
      "self",
      input,
      authorize,
      async (tx, member) => {
        await tx.execute(
          sql`UPDATE identities SET name=${input.name} WHERE id=${member.identityId} AND workspace_id=${workspaceId}`,
        );
        return { id: member.identityId };
      },
    );
  }
}
