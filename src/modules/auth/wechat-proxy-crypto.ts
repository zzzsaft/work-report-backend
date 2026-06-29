import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export interface EncryptedPayload {
  iv: string;
  tag: string;
  data: string;
}

export interface WechatProxyEncryptedBody {
  encrypted: EncryptedPayload;
}

const getKey = (secret: string) => createHash("sha256").update(secret).digest();

export const encryptJson = (payload: unknown, secret: string): EncryptedPayload => {
  const key = getKey(secret);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(payload), "utf8"),
    cipher.final()
  ]);

  return {
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: encrypted.toString("base64")
  };
};

export const decryptJson = <T = unknown>(encryptedPayload: EncryptedPayload, secret: string): T => {
  const key = getKey(secret);
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(encryptedPayload.iv, "base64"));
  decipher.setAuthTag(Buffer.from(encryptedPayload.tag, "base64"));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedPayload.data, "base64")),
    decipher.final()
  ]);

  return JSON.parse(decrypted.toString("utf8")) as T;
};

export const isWechatProxyEncryptedBody = (body: unknown): body is WechatProxyEncryptedBody => {
  if (!body || typeof body !== "object") return false;
  const encrypted = (body as { encrypted?: unknown }).encrypted;
  if (!encrypted || typeof encrypted !== "object") return false;

  const payload = encrypted as Partial<EncryptedPayload>;
  return (
    typeof payload.iv === "string" &&
    typeof payload.tag === "string" &&
    typeof payload.data === "string"
  );
};
