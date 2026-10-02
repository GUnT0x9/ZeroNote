import { it, expect } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { crc32, zipDirectoryChecksums } from "./zip-integrity";
import { extractPortableArchive } from "./portable-archive";
it("checks CRC32 and central directory sizes before accepting extracted contents", () => {
  expect(crc32(strToU8("123456789"))).toBe(0xcbf43926);
  expect(crc32(new Uint8Array())).toBe(0);
  const archive = zipSync({ "note.md": strToU8("Hello") }, { level: 0 });
  expect(zipDirectoryChecksums(archive).get("note.md")).toEqual({
    size: 5,
    crc: crc32(strToU8("Hello")),
  });
  expect(
    new TextDecoder().decode(extractPortableArchive(archive)["note.md"]),
  ).toBe("Hello");
  const corrupt = Uint8Array.from(archive);
  corrupt[37] = corrupt[37]! ^ 1;
  expect(() => extractPortableArchive(corrupt)).toThrow("Checksum");
});
it("rejects truncated, oversized and malformed directory records", () => {
  expect(() => zipDirectoryChecksums(new Uint8Array())).toThrow("손상");
  const archive = zipSync({ "a.md": strToU8("a") });
  const corrupt = Uint8Array.from(archive),
    footer = corrupt.length - 22;
  new DataView(corrupt.buffer).setUint32(footer + 16, 0xffffffff, true);
  expect(() => zipDirectoryChecksums(corrupt)).toThrow("일반 ZIP");
  expect(() => zipDirectoryChecksums(archive.slice(0, -1))).toThrow();
});
