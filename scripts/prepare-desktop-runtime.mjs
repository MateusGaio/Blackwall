// MIT License — Copyright (c) 2026 Mateus Gaio
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectDirectory = fileURLToPath(new URL("..", import.meta.url));
const runtimeDirectory = resolve(
  projectDirectory,
  process.env.BLACKWALL_DESKTOP_RUNTIME_DIR ?? "desktop-runtime",
);
const sidecarDirectory = join(projectDirectory, "sidecar", "dist");
const nodeModulesDirectory = join(projectDirectory, "node_modules");
const packageJsonPath = join(projectDirectory, "package.json");

const runtimeNode = process.env.BLACKWALL_NODE_RUNTIME || process.execPath;
const runtimeNodeName = process.platform === "win32" ? "node.exe" : "node";

async function copyDirectory(source, destination) {
  await mkdir(destination, { recursive: true });
  await cp(source, destination, { recursive: true, force: true });
}

function packagePath(packageName, baseDirectory) {
  let current = baseDirectory;
  while (true) {
    const candidate = join(current, "node_modules", packageName);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

async function copyProductionDependencies() {
  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
  const pending = Object.keys(packageJson.dependencies ?? {}).map((name) => ({
    name,
    from: projectDirectory,
  }));
  const copied = new Set();

  while (pending.length > 0) {
    const dependency = pending.pop();
    if (!dependency) continue;
    const source = packagePath(dependency.name, dependency.from);
    if (!source && !dependency.optional) {
      throw new Error(
        `Dependência de produção ausente em node_modules: ${dependency.name}. Execute npm ci antes do empacotamento.`,
      );
    }
    if (!source) continue;
    const key = `${dependency.name}:${source}`;
    if (copied.has(key)) continue;
    copied.add(key);

    const target = join(runtimeDirectory, "node_modules", dependency.name);
    await copyDirectory(source, target);
    const metadata = JSON.parse(await readFile(join(source, "package.json"), "utf8"));
    for (const name of Object.keys(metadata.dependencies ?? {}))
      pending.push({ name, from: source, optional: false });
    for (const name of Object.keys(metadata.optionalDependencies ?? {}))
      pending.push({ name, from: source, optional: true });
  }
}

async function main() {
  if (!existsSync(sidecarDirectory)) {
    throw new Error("sidecar/dist não existe. Execute npm run build:sidecar antes do empacotamento.");
  }
  if (!existsSync(nodeModulesDirectory)) {
    throw new Error("node_modules não existe. Execute npm ci antes do empacotamento.");
  }
  if (!existsSync(runtimeNode)) {
    throw new Error(`Runtime Node não encontrado: ${runtimeNode}`);
  }

  await rm(runtimeDirectory, { recursive: true, force: true });
  await mkdir(runtimeDirectory, { recursive: true });
  await cp(runtimeNode, join(runtimeDirectory, runtimeNodeName), { force: true });
  await copyDirectory(sidecarDirectory, join(runtimeDirectory, "sidecar", "dist"));
  await copyProductionDependencies();
  await writeFile(
    join(runtimeDirectory, "launch.js"),
    '// MIT License — Copyright (c) 2026 Mateus Gaio\nimport { startFromEnvironment } from "./sidecar/dist/index.js";\n\nawait startFromEnvironment();\n',
  );
  await writeFile(
    join(runtimeDirectory, "package.json"),
    JSON.stringify(
      {
        name: "blackwall-desktop-runtime",
        private: true,
        type: "module",
      },
      null,
    ) + "\n",
  );

  console.info(
    `Runtime desktop preparado em ${runtimeDirectory} usando ${basename(runtimeNode)} (${process.platform}/${process.arch}).`,
  );
}

await main();
