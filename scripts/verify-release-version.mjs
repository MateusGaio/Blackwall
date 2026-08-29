// MIT License — Copyright (c) 2026 Mateus Gaio

import { readFile } from "node:fs/promises";

const projectRoot = new URL("../", import.meta.url);
const packageJson = JSON.parse(await readFile(new URL("package.json", projectRoot), "utf8"));
const packageLock = JSON.parse(await readFile(new URL("package-lock.json", projectRoot), "utf8"));
const tauriConfig = JSON.parse(
  await readFile(new URL("src-tauri/tauri.conf.json", projectRoot), "utf8"),
);
const cargoToml = await readFile(new URL("src-tauri/Cargo.toml", projectRoot), "utf8");
const cargoLock = await readFile(new URL("src-tauri/Cargo.lock", projectRoot), "utf8");
const cargoPackage = cargoToml.match(
  /\[package\][\s\S]*?^name\s*=\s*"blackwall"[\s\S]*?^version\s*=\s*"([^"]+)"/m,
);
const cargoLockPackage = cargoLock.match(
  /\[\[package\]\][\s\S]*?^name\s*=\s*"blackwall"[\s\S]*?^version\s*=\s*"([^"]+)"/m,
);

const versions = {
  cargoLock: cargoLockPackage?.[1],
  cargo: cargoPackage?.[1],
  lock: packageLock.packages?.[""]?.version,
  package: packageJson.version,
  tauri: tauriConfig.version,
};
const uniqueVersions = new Set(Object.values(versions));
if (uniqueVersions.size !== 1 || uniqueVersions.has(undefined)) {
  throw new Error(`Versões divergentes no release: ${JSON.stringify(versions)}`);
}

const version = packageJson.version;
const requestedTag = process.argv[2] ?? process.env.GITHUB_REF_NAME;
if (requestedTag) {
  if (!/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(requestedTag)) {
    throw new Error(`Tag de release inválida: ${requestedTag}`);
  }
  if (requestedTag.slice(1) !== version) {
    throw new Error(`A tag ${requestedTag} não corresponde à versão ${version}.`);
  }
}

console.info(`Versão de release consistente: ${version}${requestedTag ? ` (${requestedTag})` : ""}.`);
