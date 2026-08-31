// MIT License — Copyright (c) 2026 Mateus Gaio
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { chmod, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

type SecretEnvelope = {
  ciphertext: string;
  iv: string;
  tag: string;
};

type SecretDocument = Record<string, string>;

const keyPath = (dataDirectory: string) => join(dataDirectory, "secrets.key");
const secretsPath = (dataDirectory: string) => join(dataDirectory, "secrets.enc");

async function readKey(dataDirectory: string): Promise<Buffer> {
  try {
    return await readFile(keyPath(dataDirectory));
  } catch (error) {
    if (!(typeof error === "object" && error && "code" in error && error.code === "ENOENT"))
      throw error;
    const key = randomBytes(32);
    await writeFile(keyPath(dataDirectory), key, { mode: 0o600 });
    await chmod(keyPath(dataDirectory), 0o600);
    return key;
  }
}

async function readSecrets(dataDirectory: string): Promise<SecretDocument> {
  try {
    const key = await readKey(dataDirectory);
    const envelope = JSON.parse(
      await readFile(secretsPath(dataDirectory), "utf8"),
    ) as SecretEnvelope;
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv, "base64"));
    decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
    return JSON.parse(
      Buffer.concat([decipher.update(envelope.ciphertext, "base64"), decipher.final()]).toString(
        "utf8",
      ),
    );
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && error.code === "ENOENT") return {};
    throw error;
  }
}

async function writeSecrets(dataDirectory: string, secrets: SecretDocument) {
  const key = await readKey(dataDirectory);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const plaintext = Buffer.from(JSON.stringify(secrets), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const envelope: SecretEnvelope = {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  };
  await writeFile(secretsPath(dataDirectory), JSON.stringify(envelope), {
    encoding: "utf8",
    mode: 0o600,
  });
  await chmod(secretsPath(dataDirectory), 0o600);
}

export async function encryptSecret(
  dataDirectory: string,
  name: string,
  value: string,
): Promise<void> {
  const secrets = await readSecrets(dataDirectory);
  secrets[name] = value;
  await writeSecrets(dataDirectory, secrets);
}

export async function decryptSecret(dataDirectory: string, name: string): Promise<string> {
  const value = (await readSecrets(dataDirectory))[name];
  if (!value) throw new Error("A chave local do provedor não foi encontrada.");
  return value;
}

export async function hasSecret(dataDirectory: string, name: string): Promise<boolean> {
  return Boolean((await readSecrets(dataDirectory))[name]);
}

export async function removeSecret(dataDirectory: string, name: string): Promise<void> {
  const secrets = await readSecrets(dataDirectory);
  if (!(name in secrets)) return;
  delete secrets[name];
  await writeSecrets(dataDirectory, secrets);
}
