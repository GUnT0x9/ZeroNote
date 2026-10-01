import { bytesToBase64 } from "@zeronote/shared";
import { database, type LocalDevice } from "./database";
import { requestJson, ApiError, WAKE_TIMEOUT_MS } from "./http";
import { useUiStore } from "./ui-store";
export { ApiError } from "./http";
let authenticatedUntil = 0,
  authentication: Promise<LocalDevice> | undefined;
let deviceLoading: Promise<LocalDevice> | undefined;
export async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  try {
    return await requestJson<T>(path, method, body);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401)
      authenticatedUntil = 0;
    throw error;
  }
}

export async function getDevice(): Promise<LocalDevice> {
  if (deviceLoading) return deviceLoading;
  deviceLoading = loadDevice();
  try {
    return await deviceLoading;
  } finally {
    deviceLoading = undefined;
  }
}
async function loadDevice(): Promise<LocalDevice> {
  const current = await database.devices.toCollection().first();
  if (current) return current;
  const keys = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign", "verify"],
  );
  const id = crypto.randomUUID(),
    device = {
      id,
      name: `나의 기기 ${id.slice(0, 4)}`,
      privateKey: keys.privateKey,
      publicKey: await crypto.subtle.exportKey("jwk", keys.publicKey),
    };
  await database.devices.put(device);
  return device;
}
export async function authenticate(force = false): Promise<LocalDevice> {
  if (authentication) return authentication;
  authentication = (async () => {
    const device = await getDevice();
    if (!force && Date.now() < authenticatedUntil) return device;
    useUiStore.getState().patch({ syncState: "connecting" });
    await requestJson("/health", "GET", undefined, WAKE_TIMEOUT_MS);
    await api("/devices", "POST", {
      id: device.id,
      name: device.name,
      publicKey: device.publicKey,
    });
    const challenge = await api<{ id: string; nonce: string }>(
      "/auth/challenge",
      "POST",
      { deviceId: device.id },
    );
    const signature = await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      device.privateKey,
      new TextEncoder().encode(challenge.nonce),
    );
    await api("/auth/verify", "POST", {
      challengeId: challenge.id,
      signature: bytesToBase64(new Uint8Array(signature)),
    });
    authenticatedUntil = Date.now() + 23 * 60 * 60 * 1000;
    return device;
  })();
  try {
    return await authentication;
  } finally {
    authentication = undefined;
  }
}
