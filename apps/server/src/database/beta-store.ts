import { sql } from "drizzle-orm";
import { BETA_WORKSPACE_LIMIT, type BetaStatus } from "@zeronote/shared";
import { env } from "../env";
import { DomainError } from "../errors";
import type { Repository, Executor } from "./repository";
export class BetaStore {
  constructor(readonly repository: Repository) {}
  async status(deviceId: string): Promise<BetaStatus> {
    const [row] = await this.repository.query<{
      codeId: string;
      count: string;
    }>(
      sql`SELECT b.code_id AS "codeId",(SELECT count(*) FROM workspaces w WHERE w.beta_code_id=b.code_id)::text AS count FROM beta_devices b WHERE device_id=${deviceId}`,
    );
    return {
      required: env.BETA_REQUIRED,
      approved: !!row || !env.BETA_REQUIRED,
      workspaceCount: Number(row?.count ?? 0),
      workspaceLimit: BETA_WORKSPACE_LIMIT,
    };
  }
  async issue(
    id: string,
    hash: string,
    expires: Date,
    executor: Executor = this.repository.database,
  ): Promise<void> {
    await executor.execute(
      sql`INSERT INTO beta_codes(id,secret_hash,expires_at) VALUES(${id},${hash},${expires.toISOString()})`,
    );
  }
  async redeem(deviceId: string, hash: string): Promise<void> {
    await this.repository.database.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${deviceId}))`,
      );
      const [code] = await this.repository.query<{
        id: string;
        deviceId: string | null;
        expired: boolean;
      }>(
        sql`SELECT id,redeemed_device_id AS "deviceId",expires_at<=now() AS expired FROM beta_codes WHERE secret_hash=${hash} FOR UPDATE`,
        tx,
      );
      if (
        !code ||
        (code.deviceId && code.deviceId !== deviceId) ||
        (!code.deviceId && code.expired)
      )
        throw new DomainError(
          410,
          "만료되었거나 이미 사용된 Beta 초대코드입니다.",
        );
      const [existing] = await this.repository.query<{ codeId: string }>(
        sql`SELECT code_id AS "codeId" FROM beta_devices WHERE device_id=${deviceId}`,
        tx,
      );
      if (existing && existing.codeId !== code.id)
        throw new DomainError(409, "이미 Beta 참여 자격이 있습니다.");
      await tx.execute(
        sql`UPDATE beta_codes SET redeemed_device_id=${deviceId},redeemed_at=COALESCE(redeemed_at,now()) WHERE id=${code.id}`,
      );
      await tx.execute(
        sql`INSERT INTO beta_devices(device_id,code_id) VALUES(${deviceId},${code.id}) ON CONFLICT DO NOTHING`,
      );
    });
  }
  async admitWorkspace(
    deviceId: string,
    executor: Executor,
  ): Promise<string | null> {
    if (!env.BETA_REQUIRED) return null;
    const [access] = await this.repository.query<{ codeId: string }>(
      sql`SELECT code_id AS "codeId" FROM beta_devices WHERE device_id=${deviceId}`,
      executor,
    );
    if (!access)
      throw new DomainError(
        403,
        "Workspace를 만들려면 Beta 초대코드가 필요합니다.",
      );
    await executor.execute(
      sql`SELECT id FROM beta_codes WHERE id=${access.codeId} FOR UPDATE`,
    );
    const [count] = await this.repository.query<{ count: string }>(
      sql`SELECT count(*)::text AS count FROM workspaces WHERE beta_code_id=${access.codeId}`,
      executor,
    );
    if (Number(count?.count ?? 0) >= BETA_WORKSPACE_LIMIT)
      throw new DomainError(
        409,
        "Beta에서는 Workspace를 최대 3개 만들 수 있습니다.",
      );
    return access.codeId;
  }
  async inherit(workspaceId: string, deviceId: string): Promise<void> {
    await this.repository.database.execute(
      sql`INSERT INTO beta_devices(device_id,code_id) SELECT ${deviceId},beta_code_id FROM workspaces WHERE id=${workspaceId} AND beta_code_id IS NOT NULL ON CONFLICT DO NOTHING`,
    );
  }
}
