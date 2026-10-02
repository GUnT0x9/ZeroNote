import { expect, it } from "vitest";
import {
  encryptWorkspaceExport,
  decryptWorkspaceExport,
  isEncryptedExport,
} from "./encrypted-export";
import type { WorkspaceExport } from "@zeronote/shared";
const input: WorkspaceExport = {
  schemaVersion: 1,
  exportedAt: "now",
  name: "비공개 문서",
  pages: [],
};
const password = "correct horse battery staple";
it("encrypts with fresh salt/IV and restores without including plaintext or the password", async () => {
  const first = await encryptWorkspaceExport(input, password),
    second = await encryptWorkspaceExport(input, password);
  expect(first.salt).not.toBe(second.salt);
  expect(first.iv).not.toBe(second.iv);
  expect(JSON.stringify(first)).not.toContain(input.name);
  expect(JSON.stringify(first)).not.toContain(password);
  expect(isEncryptedExport(first)).toBe(true);
  expect(isEncryptedExport(input)).toBe(false);
  expect(isEncryptedExport(null)).toBe(false);
  expect(await decryptWorkspaceExport(first, password)).toEqual(input);
});
it("rejects wrong passwords, tampering and unbounded KDF parameters", async () => {
  const encrypted = await encryptWorkspaceExport(input, password);
  await expect(
    decryptWorkspaceExport(encrypted, "a different password"),
  ).rejects.toThrow("암호");
  await expect(
    decryptWorkspaceExport(
      {
        ...encrypted,
        ciphertext:
          (encrypted.ciphertext.startsWith("A") ? "B" : "A") +
          encrypted.ciphertext.slice(1),
      },
      password,
    ),
  ).rejects.toThrow("손상");
  await expect(
    decryptWorkspaceExport({ ...encrypted, iterations: 999_999_999 }, password),
  ).rejects.toThrow();
  await expect(encryptWorkspaceExport(input, "short")).rejects.toThrow("12");
});
