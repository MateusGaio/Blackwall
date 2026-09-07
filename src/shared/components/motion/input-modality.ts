// MIT License — Copyright (c) 2026 Mateus Gaio

import { useEffect } from "react";

type InputModality = "keyboard" | "pointer";

export function modalityForKey(event: Pick<KeyboardEvent, "key">): InputModality {
  return event.key ? "keyboard" : "pointer";
}

function installInputModality(root: HTMLElement, target: Window = window) {
  const setModality = (modality: InputModality) => {
    root.dataset.inputModality = modality;
  };
  const onKeyDown = (event: KeyboardEvent) => setModality(modalityForKey(event));
  const onPointerDown = () => setModality("pointer");
  setModality("pointer");
  target.addEventListener("keydown", onKeyDown, true);
  target.addEventListener("pointerdown", onPointerDown, true);
  return () => {
    target.removeEventListener("keydown", onKeyDown, true);
    target.removeEventListener("pointerdown", onPointerDown, true);
    delete root.dataset.inputModality;
  };
}

export function useInputModality() {
  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    return installInputModality(document.documentElement);
  }, []);
}
