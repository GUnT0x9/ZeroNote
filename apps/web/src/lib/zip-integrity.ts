import { strFromU8 } from "fflate";
const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, value) => {
  let current = value;
  for (let index = 0; index < 8; index++)
    current = current & 1 ? 0xedb88320 ^ (current >>> 1) : current >>> 1;
  return current >>> 0;
});
export function crc32(bytes: Uint8Array): number {
  let value = 0xffffffff;
  for (const byte of bytes)
    value = CRC_TABLE[(value ^ byte) & 0xff]! ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}
export function zipDirectoryChecksums(
  data: Uint8Array,
): Map<string, { crc: number; size: number }> {
  if (data.length < 22) throw new Error("ZIP 파일이 손상되었습니다.");
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength),
    checksums = new Map<string, { crc: number; size: number }>();
  let footer = data.length - 22;
  for (; footer >= Math.max(0, data.length - 65558); footer--)
    if (
      view.getUint32(footer, true) === 0x06054b50 &&
      footer + 22 + view.getUint16(footer + 20, true) === data.length
    )
      break;
  if (footer < 0 || footer < data.length - 65558)
    throw new Error("ZIP 디렉터리가 없습니다.");
  const count = view.getUint16(footer + 10, true),
    length = view.getUint32(footer + 12, true),
    start = view.getUint32(footer + 16, true);
  if (
    view.getUint16(footer + 4, true) ||
    view.getUint16(footer + 6, true) ||
    count === 0xffff ||
    start === 0xffffffff ||
    start + length > footer
  )
    throw new Error("일반 ZIP 형식으로 다시 압축해주세요.");
  let position = start;
  for (let index = 0; index < count; index++) {
    if (
      position + 46 > start + length ||
      view.getUint32(position, true) !== 0x02014b50
    )
      throw new Error("ZIP 디렉터리가 손상되었습니다.");
    const flags = view.getUint16(position + 8, true),
      nameLength = view.getUint16(position + 28, true),
      extraLength = view.getUint16(position + 30, true),
      commentLength = view.getUint16(position + 32, true);
    const next = position + 46 + nameLength + extraLength + commentLength;
    if (flags & 1 || next > start + length)
      throw new Error(
        "암호화되거나 손상된 ZIP입니다. 암호화 백업은 ZeroNote 형식을 선택해주세요.",
      );
    const name = strFromU8(
      data.subarray(position + 46, position + 46 + nameLength),
      !(flags & 2048),
    ).normalize("NFC");
    if (checksums.has(name)) throw new Error("ZIP에 중복 경로가 있습니다.");
    checksums.set(name, {
      crc: view.getUint32(position + 16, true),
      size: view.getUint32(position + 24, true),
    });
    position = next;
  }
  if (position !== start + length)
    throw new Error("ZIP 디렉터리 크기가 일치하지 않습니다.");
  return checksums;
}
