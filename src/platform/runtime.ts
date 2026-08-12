// MIT License — Copyright (c) 2026 Mateus Gaio
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

async function readBrowserDirectory(
  entry: BrowserDirectoryEntry,
  prefix = "",
  output: WorkspaceFile[] = [],
) {
  if (output.length >= 500) return output;
  if (entry.kind === "file" && entry.getFile && /\.(md|markdown)$/i.test(entry.name)) {
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
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Escolha a pasta do workspace",
    });
    if (typeof selected !== "string") return null;
    const name = selected.split(/[\\/]/).filter(Boolean).at(-1) ?? selected;
    return { files: [], name, path: selected, source: "desktop" };
  }

  const browserWindow = window as Window & {
    showDirectoryPicker?: () => Promise<BrowserDirectoryEntry>;
  };
  if (browserWindow.showDirectoryPicker) {
    try {
      const directory = await browserWindow.showDirectoryPicker();
      const files = await readBrowserDirectory(directory);
      return { files, name: directory.name, path: null, source: "web" };
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return null;
    }
  }

  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.setAttribute("webkitdirectory", "");
    input.setAttribute("directory", "");
    input.addEventListener(
      "change",
      () => {
        const files = Array.from(input.files ?? []);
        input.remove();
        if (!files.length) {
          resolve(null);
          return;
        }
        void (async () => {
          const selectedFiles: WorkspaceFile[] = [];
          let totalBytes = 0;
          for (const file of files
            .filter((item) => /\.(md|markdown)$/i.test(item.name))
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
            (files[0] as File & { webkitRelativePath?: string }).webkitRelativePath ??
            files[0].name;
          const name = firstPath.split("/").filter(Boolean)[0] ?? "Workspace";
          resolve({ files: selectedFiles, name, path: null, source: "web" });
        })();
      },
      { once: true },
    );
    input.setAttribute("aria-label", "Escolher pasta do workspace");
    input.style.position = "fixed";
    input.style.left = "-10000px";
    input.style.top = "0";
    document.body.appendChild(input);
    input.click();
  });
}
