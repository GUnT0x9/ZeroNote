import { z } from "zod";
import {
  base64ToBytes,
  bytesToBase64,
  ExportSchema,
  type WorkspaceExport,
} from "@zeronote/shared";

const PBKDF2_ITERATIONS = 600_000;
const MAX_EXPORT_BYTES = 50 * 1024 * 1024;
const MAX_BASE64_LENGTH = Math.ceil((MAX_EXPORT_BYTES + 16) / 3) * 4;
const EnvelopeSchema = z
  .object({
    format: z.literal("zeronote-encrypted-workspace"),
    version: z.literal(1),
    cipher: z.literal("AES-256-GCM"),
    kdf: z.literal("PBKDF2-SHA-256"),
    iterations: z.literal(PBKDF2_ITERATIONS),
    salt: z.string().length(44),
    iv: z.string().length(16),
    ciphertext: z.string().min(24).max(MAX_BASE64_LENGTH),
  })
  .strict();
export type EncryptedExport = z.infer<typeof EnvelopeSchema>;
const AUTHENTICATED_HEADER = new TextEncoder().encode(
  "zeronote-encrypted-workspace:1:AES-256-GCM:PBKDF2-SHA-256:600000",
);
async function deriveKey(password: string, salt: Uint8Array) {
  if (password.length < 12 || password.length > 1024)
    throw new Error("암호는 12–1,024자로 입력해주세요.");
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: Uint8Array.from(salt),
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}
export async function encryptWorkspaceExport(
  input: WorkspaceExport,
  password: string,
): Promise<EncryptedExport> {
  const data = new TextEncoder().encode(
    JSON.stringify(ExportSchema.parse(input)),
  );
  if (data.byteLength > MAX_EXPORT_BYTES)
    throw new Error("암호화 백업은 50MiB 이하로 저장해주세요.");
  const salt = crypto.getRandomValues(new Uint8Array(32)),
    iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: AUTHENTICATED_HEADER },
    key,
    data,
  );
  return {
    format: "zeronote-encrypted-workspace",
    version: 1,
    cipher: "AES-256-GCM",
    kdf: "PBKDF2-SHA-256",
    iterations: PBKDF2_ITERATIONS,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
  };
}
export async function decryptWorkspaceExport(
  input: unknown,
  password: string,
): Promise<WorkspaceExport> {
  const parsed = EnvelopeSchema.parse(input),
    salt = base64ToBytes(parsed.salt),
    iv = base64ToBytes(parsed.iv);
  if (salt.length !== 32 || iv.length !== 12)
    throw new Error("암호화 백업의 형식이 올바르지 않습니다.");
  const key = await deriveKey(password, salt);
  try {
    const data = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: Uint8Array.from(iv),
        additionalData: AUTHENTICATED_HEADER,
      },
      key,
      Uint8Array.from(base64ToBytes(parsed.ciphertext)),
    );
    if (data.byteLength > MAX_EXPORT_BYTES)
      throw new Error("백업 크기 제한을 초과했습니다.");
    const value: unknown = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(data),
    );
    return ExportSchema.parse(value);
  } catch {
    throw new Error("암호가 다르거나 백업 파일이 손상되었습니다.");
  }
}
export function isEncryptedExport(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    "format" in value &&
    value.format === "zeronote-encrypted-workspace"
  );
}
