import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function key() {
  const encoded = process.env.HRMS_EMPLOYEE_ENCRYPTION_KEY;
  if (!encoded || !/^[A-Za-z0-9+/]{43}=$/.test(encoded)) throw new Error("HRMS_EMPLOYEE_ENCRYPTION_KEY must be a base64-encoded 32-byte key");
  return Buffer.from(encoded, "base64");
}

/** Bind each authenticated envelope to its Employee record and field to prevent ciphertext substitution. */
export function encryptEmployeeId(value: string, employeeId: number, field: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(`${employeeId}:${field}`));
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), ciphertext.toString("base64")].join(":");
}

export function decryptEmployeeId(envelope: string, employeeId: number, field: string) {
  const [version, iv, tag, ciphertext, extra] = envelope.split(":");
  if (version !== "v1" || !iv || !tag || !ciphertext || extra !== undefined) throw new Error("Invalid encrypted government ID");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
  decipher.setAAD(Buffer.from(`${employeeId}:${field}`));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64")), decipher.final()]).toString("utf8");
}
