import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql, type SQL } from "drizzle-orm";
import { DomainError } from "../errors";
import { migrateDatabase } from "./migrations";
import { DocumentStore } from "./document-store";
import { BetaStore } from "./beta-store";
import { SnapshotStore } from "./snapshot-store";
import type { Page, Workspace, Role, PageComment } from "@zeronote/shared";

export interface DeviceRecord {
  id: string;
  name: string;
  publicKey: JsonWebKey;
}
export interface MembershipRecord {
  workspaceId: string;
  deviceId: string;
  identityId: string;
  name: string;
  ownerIdentityId: string;
  revokedAt: string | null;
}
export interface GrantRecord {
  id: string;
  workspaceId: string;
  pageId: string;
  identityId: string;
  role: Role;
  includeDescendants: boolean;
  revokedAt: string | null;
}
export interface InviteRecord {
  id: string;
  workspaceId: string;
  pageId: string;
  role: Exclude<Role, "owner">;
  includeDescendants: boolean;
  secretHash: string;
  expiresAt: string;
  redeemedIdentityId: string | null;
  revokedAt: string | null;
}
export type Executor = Pick<ReturnType<typeof drizzle>, "execute">;

export class Repository {
  readonly pool: Pool;
  readonly database: ReturnType<typeof drizzle>;
  readonly documents: DocumentStore;
  readonly beta: BetaStore;
  readonly snapshots: SnapshotStore;
  constructor(url: string) {
    this.pool = new Pool({
      connectionString: url,
      max: 5,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 10_000,
    });
    this.database = drizzle(this.pool);
    this.documents = new DocumentStore(this);
    this.beta = new BetaStore(this);
    this.snapshots = new SnapshotStore(this);
  }
  async query<T>(
    statement: SQL,
    executor: Executor = this.database,
  ): Promise<T[]> {
    const result = await executor.execute(statement);
    return result.rows as T[];
  }
  async migrate(): Promise<void> {
    await migrateDatabase(this.pool);
  }
  async close(): Promise<void> {
    await this.pool.end();
  }
  async getDevice(id: string): Promise<DeviceRecord | undefined> {
    return (
      await this.query<DeviceRecord>(
        sql`SELECT id,name,public_key AS "publicKey" FROM devices WHERE id=${id}`,
      )
    )[0];
  }
  async registerDevice(device: DeviceRecord): Promise<void> {
    await this.database.execute(
      sql`INSERT INTO devices(id,name,public_key) VALUES(${device.id},${device.name},${JSON.stringify(device.publicKey)}::jsonb) ON CONFLICT(id) DO NOTHING`,
    );
  }
  async createChallenge(
    id: string,
    deviceId: string,
    nonce: string,
    expires: Date,
  ): Promise<void> {
    await this.database.execute(
      sql`INSERT INTO challenges(id,device_id,nonce,expires_at) VALUES(${id},${deviceId},${nonce},${expires.toISOString()})`,
    );
  }
  async getChallenge(
    id: string,
  ): Promise<
    { deviceId: string; nonce: string; expiresAt: string } | undefined
  > {
    return (
      await this.query<{ deviceId: string; nonce: string; expiresAt: string }>(
        sql`SELECT device_id AS "deviceId",nonce,expires_at::text AS "expiresAt" FROM challenges WHERE id=${id}`,
      )
    )[0];
  }
  async consumeChallengeAndCreateSession(
    id: string,
    deviceId: string,
    tokenHash: string,
    expires: Date,
  ): Promise<boolean> {
    return this.database.transaction(async (transaction) => {
      const consumed = await this.query<{ id: string }>(
        sql`DELETE FROM challenges WHERE id=${id} AND device_id=${deviceId} AND expires_at>now() RETURNING id`,
        transaction,
      );
      if (!consumed.length) return false;
      await transaction.execute(
        sql`INSERT INTO sessions(token_hash,device_id,expires_at) VALUES(${tokenHash},${deviceId},${expires.toISOString()})`,
      );
      return true;
    });
  }
  async sessionDevice(hash: string): Promise<string | undefined> {
    return (
      await this.query<{ deviceId: string }>(
        sql`SELECT device_id AS "deviceId" FROM sessions WHERE token_hash=${hash} AND expires_at>now()`,
      )
    )[0]?.deviceId;
  }
  async getMembership(
    deviceId: string,
    workspaceId: string,
  ): Promise<MembershipRecord | undefined> {
    return (
      await this.query<MembershipRecord>(
        sql`SELECT m.workspace_id AS "workspaceId",m.device_id AS "deviceId",m.identity_id AS "identityId",i.name,w.owner_identity_id AS "ownerIdentityId",m.revoked_at::text AS "revokedAt" FROM memberships m JOIN identities i ON i.id=m.identity_id JOIN workspaces w ON w.id=m.workspace_id WHERE m.device_id=${deviceId} AND m.workspace_id=${workspaceId}`,
      )
    )[0];
  }
  async listWorkspaces(deviceId: string): Promise<Workspace[]> {
    return this.query<Workspace>(
      sql`SELECT w.id,w.name,w.owner_identity_id AS "ownerIdentityId",w.created_at::text AS "createdAt" FROM workspaces w JOIN memberships m ON m.workspace_id=w.id WHERE m.device_id=${deviceId} AND m.revoked_at IS NULL ORDER BY w.created_at`,
    );
  }
  async getWorkspace(
    id: string,
  ): Promise<(Workspace & { recoveryHash: string }) | undefined> {
    return (
      await this.query<Workspace & { recoveryHash: string }>(
        sql`SELECT id,name,owner_identity_id AS "ownerIdentityId",recovery_hash AS "recoveryHash",created_at::text AS "createdAt" FROM workspaces WHERE id=${id}`,
      )
    )[0];
  }
  async createWorkspace(
    workspace: Workspace & { recoveryHash: string },
    device: DeviceRecord,
  ): Promise<void> {
    await this.database.transaction(async (transaction) => {
      await transaction.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${workspace.id}))`,
      );
      const existing = await this.query(
        sql`SELECT id FROM workspaces WHERE id=${workspace.id}`,
        transaction,
      );
      if (existing.length) {
        const owner = await this.query(
          sql`SELECT 1 FROM memberships m JOIN workspaces w ON w.id=m.workspace_id WHERE w.id=${workspace.id} AND m.device_id=${device.id} AND m.identity_id=w.owner_identity_id AND m.revoked_at IS NULL`,
          transaction,
        );
        if (!owner.length)
          throw new DomainError(403, "Workspace Owner 권한이 필요합니다.");
        return;
      }
      const codeId = await this.beta.admitWorkspace(device.id, transaction);
      await this.documents.assertCapacity(transaction);
      await transaction.execute(
        sql`INSERT INTO workspaces(id,name,owner_identity_id,recovery_hash,created_at,beta_code_id) VALUES(${workspace.id},${workspace.name},${workspace.ownerIdentityId},${workspace.recoveryHash},${workspace.createdAt},${codeId})`,
      );
      await transaction.execute(
        sql`INSERT INTO identities(id,workspace_id,name) VALUES(${workspace.ownerIdentityId},${workspace.id},${device.name})`,
      );
      await transaction.execute(
        sql`INSERT INTO memberships(workspace_id,device_id,identity_id) VALUES(${workspace.id},${device.id},${workspace.ownerIdentityId})`,
      );
    });
  }
  async recoverWorkspace(
    hash: string,
    deviceId: string,
  ): Promise<Workspace | undefined> {
    const workspace = (
      await this.query<Workspace>(
        sql`SELECT id,name,owner_identity_id AS "ownerIdentityId",created_at::text AS "createdAt" FROM workspaces WHERE recovery_hash=${hash}`,
      )
    )[0];
    if (workspace)
      await this.database.execute(
        sql`INSERT INTO memberships(workspace_id,device_id,identity_id) VALUES(${workspace.id},${deviceId},${workspace.ownerIdentityId}) ON CONFLICT(workspace_id,device_id) DO UPDATE SET identity_id=excluded.identity_id,revoked_at=NULL`,
      );
    if (workspace) await this.beta.inherit(workspace.id, deviceId);
    return workspace;
  }
  async rotateRecovery(workspaceId: string, hash: string): Promise<void> {
    await this.database.execute(
      sql`UPDATE workspaces SET recovery_hash=${hash} WHERE id=${workspaceId}`,
    );
  }
  async deleteWorkspace(workspaceId: string): Promise<void> {
    await this.database.execute(
      sql`DELETE FROM workspaces WHERE id=${workspaceId}`,
    );
  }
  async listPages(workspaceId: string): Promise<Page[]> {
    return this.query<Page>(
      sql`SELECT id,workspace_id AS "workspaceId",parent_id AS "parentId",kind,title,revision,deleted_at::text AS "deletedAt",created_at::text AS "createdAt",is_inbox AS "isInbox" FROM pages WHERE workspace_id=${workspaceId} ORDER BY created_at`,
    );
  }
  async getPage(id: string): Promise<Page | undefined> {
    return (
      await this.query<Page>(
        sql`SELECT id,workspace_id AS "workspaceId",parent_id AS "parentId",kind,title,revision,deleted_at::text AS "deletedAt",created_at::text AS "createdAt",is_inbox AS "isInbox" FROM pages WHERE id=${id}`,
      )
    )[0];
  }
  async getOperation(id: string, deviceId: string): Promise<Page | undefined> {
    return (
      await this.query<{ result: Page }>(
        sql`SELECT result FROM metadata_operations WHERE operation_id=${id} AND device_id=${deviceId}`,
      )
    )[0]?.result;
  }
  async listGrants(identityId: string): Promise<GrantRecord[]> {
    return this.query<GrantRecord>(
      sql`SELECT id,workspace_id AS "workspaceId",page_id AS "pageId",identity_id AS "identityId",role,include_descendants AS "includeDescendants",revoked_at::text AS "revokedAt" FROM grants WHERE identity_id=${identityId} AND revoked_at IS NULL`,
    );
  }
  async applyPageOperation(
    operationId: string,
    deviceId: string,
    page: Page,
    create: boolean,
    expectedRevision: number,
  ): Promise<Page | undefined> {
    return this.database.transaction(async (transaction) => {
      const existing = await this.query<{ deviceId: string; result: Page }>(
        sql`SELECT device_id AS "deviceId",result FROM metadata_operations WHERE operation_id=${operationId}`,
        transaction,
      );
      if (existing[0])
        return existing[0].deviceId === deviceId
          ? existing[0].result
          : undefined;
      if (create) await this.documents.assertCapacity(transaction);
      let results: Page[];
      if (create) {
        results = await this.query<Page>(
          sql`INSERT INTO pages(id,workspace_id,parent_id,kind,title,revision,deleted_at,created_at,is_inbox) VALUES(${page.id},${page.workspaceId},${page.parentId},${page.kind},${page.title},0,NULL,${page.createdAt},${page.isInbox}) ON CONFLICT(id) DO NOTHING RETURNING id,workspace_id AS "workspaceId",parent_id AS "parentId",kind,title,revision,deleted_at::text AS "deletedAt",created_at::text AS "createdAt",is_inbox AS "isInbox"`,
          transaction,
        );
      } else
        results = await this.query<Page>(
          sql`UPDATE pages SET parent_id=${page.parentId},deleted_at=${page.deletedAt},revision=revision+1 WHERE id=${page.id} AND revision=${expectedRevision} RETURNING id,workspace_id AS "workspaceId",parent_id AS "parentId",kind,title,revision,deleted_at::text AS "deletedAt",created_at::text AS "createdAt",is_inbox AS "isInbox"`,
          transaction,
        );
      const result = results[0];
      if (!result) return undefined;
      await transaction.execute(
        sql`INSERT INTO metadata_operations(operation_id,device_id,result) VALUES(${operationId},${deviceId},${JSON.stringify(result)}::jsonb)`,
      );
      return result;
    });
  }
  async loadDocument(pageId: string): Promise<Uint8Array[]> {
    return this.documents.load(pageId);
  }
  async appendUpdate(
    pageId: string,
    operationId: string,
    update: Uint8Array,
  ): Promise<void> {
    await this.documents.commit(pageId, operationId, update);
  }
  async checkpoint(
    pageId: string,
    _update: Uint8Array,
    _title: string,
  ): Promise<void> {
    await this.documents.compact(pageId);
  }
  async createInvite(
    invite: Omit<InviteRecord, "redeemedIdentityId" | "revokedAt">,
  ): Promise<void> {
    await this.documents.assertCapacity();
    await this.database.execute(
      sql`INSERT INTO invites(id,workspace_id,page_id,role,include_descendants,secret_hash,expires_at) VALUES(${invite.id},${invite.workspaceId},${invite.pageId},${invite.role},${invite.includeDescendants},${invite.secretHash},${invite.expiresAt})`,
    );
  }
  async redeemInvite(
    id: string,
    hash: string,
    device: DeviceRecord,
  ): Promise<{ pageId: string; workspaceId: string } | undefined> {
    return this.database.transaction(async (transaction) => {
      const invite = (
        await this.query<InviteRecord>(
          sql`SELECT id,workspace_id AS "workspaceId",page_id AS "pageId",role,include_descendants AS "includeDescendants",secret_hash AS "secretHash",expires_at::text AS "expiresAt",redeemed_identity_id AS "redeemedIdentityId",revoked_at::text AS "revokedAt" FROM invites WHERE id=${id} FOR UPDATE`,
          transaction,
        )
      )[0];
      if (
        !invite ||
        invite.secretHash !== hash ||
        invite.revokedAt ||
        new Date(invite.expiresAt).getTime() < Date.now()
      )
        return undefined;
      const membership = await this.getMembership(
        device.id,
        invite.workspaceId,
      );
      if (invite.redeemedIdentityId)
        return membership?.identityId === invite.redeemedIdentityId &&
          !membership.revokedAt
          ? { pageId: invite.pageId, workspaceId: invite.workspaceId }
          : undefined;
      const identityId =
        membership && !membership.revokedAt
          ? membership.identityId
          : crypto.randomUUID();
      if (!membership || membership.revokedAt) {
        await transaction.execute(
          sql`INSERT INTO identities(id,workspace_id,name) VALUES(${identityId},${invite.workspaceId},${device.name})`,
        );
        await transaction.execute(
          sql`INSERT INTO memberships(workspace_id,device_id,identity_id) VALUES(${invite.workspaceId},${device.id},${identityId}) ON CONFLICT(workspace_id,device_id) DO UPDATE SET identity_id=excluded.identity_id,revoked_at=NULL`,
        );
      }
      await transaction.execute(
        sql`INSERT INTO grants(id,workspace_id,page_id,identity_id,role,include_descendants) VALUES(${crypto.randomUUID()},${invite.workspaceId},${invite.pageId},${identityId},${invite.role},${invite.includeDescendants})`,
      );
      await transaction.execute(
        sql`UPDATE invites SET redeemed_identity_id=${identityId} WHERE id=${id}`,
      );
      return { pageId: invite.pageId, workspaceId: invite.workspaceId };
    });
  }
  async listPageGrants(
    pageId: string,
  ): Promise<(GrantRecord & { name: string })[]> {
    return this.query(
      sql`SELECT g.id,g.workspace_id AS "workspaceId",g.page_id AS "pageId",g.identity_id AS "identityId",g.role,g.include_descendants AS "includeDescendants",g.revoked_at::text AS "revokedAt",i.name FROM grants g JOIN identities i ON i.id=g.identity_id WHERE g.page_id=${pageId} AND g.revoked_at IS NULL`,
    );
  }
  async revokeGrant(pageId: string, id: string): Promise<void> {
    await this.database.execute(
      sql`UPDATE grants SET revoked_at=now() WHERE id=${id} AND page_id=${pageId}`,
    );
  }
  async cancelInvite(pageId: string, id: string): Promise<void> {
    await this.database.execute(
      sql`UPDATE invites SET revoked_at=now() WHERE id=${id} AND page_id=${pageId}`,
    );
  }
  async listInvites(pageId: string): Promise<
    {
      id: string;
      role: string;
      expiresAt: string;
      redeemed: boolean;
      revoked: boolean;
    }[]
  > {
    return this.query(
      sql`SELECT id,role,expires_at::text AS "expiresAt",redeemed_identity_id IS NOT NULL AS redeemed,revoked_at IS NOT NULL AS revoked FROM invites WHERE page_id=${pageId} ORDER BY expires_at DESC`,
    );
  }
  async listIdentities(
    workspaceId: string,
  ): Promise<{ id: string; name: string }[]> {
    return this.query(
      sql`SELECT DISTINCT i.id,i.name FROM identities i JOIN memberships m ON m.identity_id=i.id WHERE i.workspace_id=${workspaceId} AND m.revoked_at IS NULL`,
    );
  }
  async listDevices(
    workspaceId: string,
  ): Promise<
    { id: string; name: string; identityId: string; revoked: boolean }[]
  > {
    return this.query(
      sql`SELECT d.id,d.name,m.identity_id AS "identityId",m.revoked_at IS NOT NULL AS revoked FROM devices d JOIN memberships m ON m.device_id=d.id WHERE m.workspace_id=${workspaceId}`,
    );
  }
  async revokeDevice(workspaceId: string, deviceId: string): Promise<void> {
    await this.database.execute(
      sql`UPDATE memberships SET revoked_at=now() WHERE workspace_id=${workspaceId} AND device_id=${deviceId}`,
    );
  }
  async listComments(pageId: string): Promise<PageComment[]> {
    return this.query(
      sql`SELECT c.id,c.page_id AS "pageId",c.parent_id AS "parentId",c.body,c.identity_id AS "identityId",i.name AS "authorName",c.resolved,c.created_at::text AS "createdAt" FROM comments c JOIN identities i ON i.id=c.identity_id WHERE c.page_id=${pageId} ORDER BY c.created_at`,
    );
  }
  async createComment(comment: {
    id: string;
    pageId: string;
    parentId: string | null;
    body: string;
    identityId: string;
  }): Promise<void> {
    await this.documents.assertCapacity();
    await this.database.execute(
      sql`INSERT INTO comments(id,page_id,parent_id,body,identity_id) VALUES(${comment.id},${comment.pageId},${comment.parentId},${comment.body},${comment.identityId}) ON CONFLICT(id) DO NOTHING`,
    );
  }
  async resolveComment(
    pageId: string,
    id: string,
    resolved: boolean,
  ): Promise<void> {
    await this.database.execute(
      sql`UPDATE comments SET resolved=${resolved} WHERE id=${id} AND page_id=${pageId}`,
    );
  }
}
