import { bytesToBase64 } from "@zeronote/shared";
import { database, type LocalDevice } from "./database";
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
let authenticatedUntil = 0,
  authentication: Promise<LocalDevice> | undefined;
let deviceLoading: Promise<LocalDevice> | undefined;
export async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch(`/v1${path}`, {
    method,
    credentials: "same-origin",
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result: unknown = await response.json();
  if (!response.ok) {
    if (response.status === 401) authenticatedUntil = 0;
    const message =
      typeof result === "object" &&
      result &&
      "error" in result &&
      typeof result.error === "string"
        ? result.error
        : "서버에 연결할 수 없습니다.";
    throw new ApiError(response.status, message);
  }
  return result as T;
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
