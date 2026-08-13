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

export async function browserFilesToFolderSelection(
  files: File[] | FileList,
): Promise<FolderSelection | null> {
  const selected = Array.from(files);
  if (!selected.length) return null;
  const selectedFiles: WorkspaceFile[] = [];
  let totalBytes = 0;
  for (const file of selected.filter((item) => /\.(md|markdown)$/i.test(item.name)).slice(0, 500)) {
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
  return { files: selectedFiles, name, path: null, source: "web" };
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
export function pickBrowserDirectory(
  locale: "pt-BR" | "en" = "pt-BR",
): Promise<FolderSelection | null> {
  const browserWindow = window as Window & {
    showDirectoryPicker?: () => Promise<BrowserDirectoryEntry>;
  };
  if (browserWindow.showDirectoryPicker) {
    try {
      return browserWindow
        .showDirectoryPicker()
        .then(async (directory) => ({
          files: await readBrowserDirectory(directory),
          name: directory.name,
          path: null,
          source: "web" as const,
        }))
        .catch((error) => {
          if (error instanceof DOMException && error.name === "AbortError") return null;
          const input = document.createElement("input");
          input.type = "file";
          input.multiple = true;
          input.setAttribute("webkitdirectory", "");
          input.setAttribute("directory", "");
          input.setAttribute(
            "aria-label",
            locale === "en" ? "Choose workspace folder" : "Escolher pasta do workspace",
          );
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
  input.setAttribute(
    "aria-label",
    locale === "en" ? "Choose workspace folder" : "Escolher pasta do workspace",
  );
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

export async function pickDirectory(
  locale: "pt-BR" | "en" = "pt-BR",
): Promise<FolderSelection | null> {
  if (isTauri()) {
    let selected: string | string[] | null;
    try {
      selected = await open({
        directory: true,
        multiple: false,
        title: locale === "en" ? "Choose the workspace folder" : "Escolha a pasta do workspace",
      });
    } catch {
      throw new Error("Não foi possível abrir o seletor de pastas do desktop.");
    }
    if (typeof selected !== "string") return null;
    const name = selected.split(/[\\/]/).filter(Boolean).at(-1) ?? selected;
    return { files: [], name, path: selected, source: "desktop" };
  }

  return pickBrowserDirectory(locale);
}
