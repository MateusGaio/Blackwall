// MIT License — Copyright (c) 2026 Mateus Gaio
import i18n from "i18next";
import "../i18n";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

export type WorkspaceFile = {
  content: string;
  relativePath: string;
};

export type FolderSelection = {
  files: WorkspaceFile[];
  name: string;
  path: string | null;
  source: "desktop" | "web";
};

type BrowserDirectoryEntry = {
  kind: "file" | "directory";
  name: string;
  getFile?: () => Promise<File>;
  values?: () => AsyncIterable<BrowserDirectoryEntry>;
};

const workspaceTextExtensions = new Set([
  ".c",
  ".cpp",
  ".css",
  ".csv",
  ".go",
  ".h",
  ".html",
  ".java",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".markdown",
  ".py",
  ".rs",
  ".sh",
  ".sql",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".xml",
  ".yaml",
  ".yml",
]);
const workspaceTextFiles = new Set([
  ".env.example",
  "cargo.lock",
  "dockerfile",
  "license",
  "makefile",
  "package-lock.json",
  "pnpm-lock.yaml",
  "readme",
  "yarn.lock",
]);
const ignoredWorkspaceSegments = new Set([
  ".cache",
  ".git",
  ".next",
  ".pytest_cache",
  ".turbo",
  ".venv",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "target",
  "vendor",
]);

function canImportWorkspaceFile(path: string): boolean {
  const segments = path.split("/").filter(Boolean);
  if (segments.some((segment) => ignoredWorkspaceSegments.has(segment))) return false;
  const name = segments.at(-1)?.toLowerCase() ?? "";
  const dot = name.lastIndexOf(".");
  return workspaceTextFiles.has(name) || (dot >= 0 && workspaceTextExtensions.has(name.slice(dot)));
}

async function readBrowserDirectory(
  entry: BrowserDirectoryEntry,
  prefix = "",
  output: WorkspaceFile[] = [],
) {
  if (output.length >= 500) return output;
  if (entry.kind === "file" && entry.getFile && canImportWorkspaceFile(`${prefix}${entry.name}`)) {
    const file = await entry.getFile();
    if (file.size <= 2_000_000) {
      output.push({ content: await file.text(), relativePath: `${prefix}${entry.name}` });
    }
    return output;
  }
  if (entry.kind === "directory" && entry.values) {
    for await (const child of entry.values()) {
      await readBrowserDirectory(child, `${prefix}${entry.name}/`, output);
      if (output.length >= 500) break;
    }
  }
  return output;
}

export async function browserFilesToFolderSelection(
  files: File[] | FileList,
): Promise<FolderSelection | null> {
  const selected = Array.from(files);
  if (!selected.length) return null;
  const selectedFiles: WorkspaceFile[] = [];
  let totalBytes = 0;
  for (const file of selected
    .filter((item) =>
      canImportWorkspaceFile(
        (item as File & { webkitRelativePath?: string }).webkitRelativePath || item.name,
      ),
    )
    .slice(0, 500)) {
    if (totalBytes >= 25_000_000 || file.size > 2_000_000) continue;
    const content = await file.text();
    if (totalBytes + content.length > 25_000_000) break;
    totalBytes += content.length;
    selectedFiles.push({
      content,
      relativePath:
        (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name,
    });
  }
  const firstPath =
    (selected[0] as File & { webkitRelativePath?: string }).webkitRelativePath ?? selected[0].name;
  const name = firstPath.split("/").filter(Boolean)[0] ?? "Workspace";
  const rootPrefix = `${name}/`;
  return {
    files: selectedFiles.map((file) => ({
      ...file,
      relativePath: file.relativePath.startsWith(rootPrefix)
        ? file.relativePath.slice(rootPrefix.length)
        : file.relativePath,
    })),
    name,
    path: null,
    source: "web",
  };
}

function readBrowserInput(input: HTMLInputElement): Promise<FolderSelection | null> {
  return new Promise((resolve) => {
    input.addEventListener(
      "change",
      () => {
        const files = Array.from(input.files ?? []);
        input.remove();
        if (!files.length) {
          resolve(null);
          return;
        }
        void browserFilesToFolderSelection(files).then(resolve);
      },
      { once: true },
    );
    input.click();
  });
}

/**
 * Starts the browser picker during the original click event. Keeping the
 * picker invocation synchronous preserves the browser's transient user
 * activation, including in localhost web-dev builds.
 */
export function pickBrowserDirectory(): Promise<FolderSelection | null> {
  const browserWindow = window as Window & {
    showDirectoryPicker?: () => Promise<BrowserDirectoryEntry>;
  };
  if (browserWindow.showDirectoryPicker) {
    try {
      return browserWindow
        .showDirectoryPicker()
        .then(async (directory) => {
          const rootPrefix = `${directory.name}/`;
          return {
            files: (await readBrowserDirectory(directory)).map((file) => ({
              ...file,
              relativePath: file.relativePath.startsWith(rootPrefix)
                ? file.relativePath.slice(rootPrefix.length)
                : file.relativePath,
            })),
            name: directory.name,
            path: null,
            source: "web" as const,
          };
        })
        .catch((error) => {
          if (error instanceof DOMException && error.name === "AbortError") return null;
          const input = document.createElement("input");
          input.type = "file";
          input.multiple = true;
          input.setAttribute("webkitdirectory", "");
          input.setAttribute("directory", "");
          input.setAttribute("aria-label", i18n.t("runtime.chooseFolderInput"));
          input.style.position = "fixed";
          input.style.left = "-10000px";
          input.style.top = "0";
          document.body.appendChild(input);
          return readBrowserInput(input);
        });
    } catch {
      // Fall through to the compatible input picker below.
    }
  }

  const input = document.createElement("input");
  input.type = "file";
  input.multiple = true;
  input.setAttribute("webkitdirectory", "");
  input.setAttribute("directory", "");
  input.setAttribute("aria-label", i18n.t("runtime.chooseFolderInput"));
  input.style.position = "fixed";
  input.style.left = "-10000px";
  input.style.top = "0";
  document.body.appendChild(input);
  return readBrowserInput(input);
}

export function currentRuntime(): "desktop" | "web" {
  return isTauri() ? "desktop" : "web";
}

export async function sidecarUrl(): Promise<string> {
  if (isTauri()) {
    const config = await invoke<{ sidecar_url: string }>("runtime_config");
    return config.sidecar_url;
  }
  return import.meta.env.VITE_SIDECAR_URL ?? "";
}

export async function pickDirectory(): Promise<FolderSelection | null> {
  if (isTauri()) {
    let selected: string | string[] | null;
    try {
      selected = await open({
        directory: true,
        multiple: false,
        title: i18n.t("runtime.chooseFolderTitle"),
      });
    } catch {
      throw new Error(i18n.t("errors.desktopFolderPicker"));
    }
    if (typeof selected !== "string") return null;
    const name = selected.split(/[\\/]/).filter(Boolean).at(-1) ?? selected;
    return { files: [], name, path: selected, source: "desktop" };
  }

  return pickBrowserDirectory();
}
