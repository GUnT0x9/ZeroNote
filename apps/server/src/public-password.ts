import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
const PASSWORD_BYTES = 32;
function derive(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(
      password,
      salt,
      PASSWORD_BYTES,
      { N: 16384, r: 8, p: 1, maxmem: 32 * 1024 * 1024 },
      (error, key) => (error ? reject(error) : resolve(key)),
    ),
  );
}
export async function hashPublicPassword(password: string): Promise<string> {
  const salt = randomBytes(32).toString("hex");
  return `${salt}:${(await derive(password, salt)).toString("hex")}`;
}
export async function verifyPublicPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const [salt, hash] = stored.split(":");
  if (
    !salt ||
    !hash ||
    !/^[a-f0-9]{64}$/.test(salt) ||
    !/^[a-f0-9]{64}$/.test(hash)
  )
    return false;
  return timingSafeEqual(
    Buffer.from(hash, "hex"),
    await derive(password, salt),
  );
}
