// MIT License — Copyright (c) 2026 Mateus Gaio
type ComposerKeyEvent = {
  isComposing: boolean;
  key: string;
  shiftKey: boolean;
};

export function isSubmitShortcut({ isComposing, key, shiftKey }: ComposerKeyEvent) {
  return key === "Enter" && !shiftKey && !isComposing;
}
