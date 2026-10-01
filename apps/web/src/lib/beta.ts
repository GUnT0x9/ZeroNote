import { BetaStatusSchema, type BetaStatus } from "@zeronote/shared";
import { api, authenticate } from "./api";
import { publicEnvironment } from "./env";
import { database } from "./database";
export const clientBetaRequired = publicEnvironment.betaRequired;
export async function refreshBetaStatus(): Promise<BetaStatus> {
  await authenticate();
  const status = BetaStatusSchema.parse(await api("/beta/status"));
  await database.preferences.put({ id: "beta", value: JSON.stringify(status) });
  return status;
}
export async function redeemBetaCode(code: string): Promise<void> {
  await authenticate();
  const status = BetaStatusSchema.parse(
    await api("/beta/redeem", "POST", { code }),
  );
  await database.preferences.put({ id: "beta", value: JSON.stringify(status) });
}
export async function requireBetaAccess(): Promise<void> {
  if (!clientBetaRequired) return;
  let status: BetaStatus | undefined;
  if (navigator.onLine) status = await refreshBetaStatus();
  else {
    const cache = await database.preferences.get("beta");
    if (cache) status = BetaStatusSchema.parse(JSON.parse(cache.value));
  }
  if (!status?.approved)
    throw new Error(
      "Beta 초대코드를 입력해주세요. 처음 참여할 때는 서버 연결이 필요합니다.",
    );
  const pending = await database.workspaces
    .filter((workspace) => workspace.pendingCreation)
    .count();
  if (
    status.required &&
    status.workspaceCount + pending >= status.workspaceLimit
  )
    throw new Error("Beta에서는 Workspace를 최대 3개 만들 수 있습니다.");
}
