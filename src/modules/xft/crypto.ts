import pkg from "sm-crypto";

const { sm2, sm3, sm4 } = pkg;

export { sm2, sm3 };

export const encryptionKey = (authoritySecret: string) => authoritySecret.slice(0, 32);

export const encryptXftBody = (body: string, authoritySecret: string) =>
  sm4.encrypt(body, encryptionKey(authoritySecret));

export const decryptXftBody = (body: string, authoritySecret: string) =>
  sm4.decrypt(body, encryptionKey(authoritySecret));

export const buildEncryptedXftRequestBody = (payload: unknown, authoritySecret: string) =>
  JSON.stringify({
    secretMsg: encryptXftBody(JSON.stringify(payload ?? {}), authoritySecret)
  });

export const parseXftResponseData = (data: unknown, authoritySecret: string) => {
  if (typeof data !== "string") return data;

  const encrypted = data.trim().replace(/^"|"$/g, "");
  if (!encrypted) return data;

  try {
    const decrypted = decryptXftBody(encrypted, authoritySecret);
    try {
      return JSON.parse(decrypted) as unknown;
    } catch {
      return decrypted;
    }
  } catch {
    try {
      return JSON.parse(data) as unknown;
    } catch {
      return data;
    }
  }
};
