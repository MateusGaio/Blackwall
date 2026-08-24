// MIT License — Copyright (c) 2026 Mateus Gaio
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useTranslation } from "react-i18next";
import { currentRuntime } from "../../platform/runtime";
import { CompactIcon } from "./CompactIcon";

type WindowAction = "close" | "minimize" | "toggleMaximize";

/** Controles da janela frameless — renderizados somente em runtime desktop. */
export function WindowControls() {
  const { t } = useTranslation();
  if (currentRuntime() !== "desktop") return null;

  function control(action: WindowAction) {
    void getCurrentWindow()[action]();
  }

  return (
    <div className="window-controls">
      <button
        aria-label={t("window.minimize")}
        className="window-control"
        onClick={() => control("minimize")}
        title={t("window.minimize")}
        type="button"
      >
        <CompactIcon kind="minimize" />
      </button>
      <button
        aria-label={t("window.maximize")}
        className="window-control"
        onClick={() => control("toggleMaximize")}
        title={t("window.maximize")}
        type="button"
      >
        <CompactIcon kind="maximize" />
      </button>
      <button
        aria-label={t("window.close")}
        className="window-control is-close"
        onClick={() => control("close")}
        title={t("window.close")}
        type="button"
      >
        <CompactIcon kind="close" />
      </button>
    </div>
  );
}
