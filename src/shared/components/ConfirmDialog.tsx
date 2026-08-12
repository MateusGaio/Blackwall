// MIT License — Copyright (c) 2026 Mateus Gaio
import { useEffect, useRef } from "react";

type ConfirmDialogProps = {
  cancelLabel?: string;
  confirmLabel?: string;
  description: string;
  onCancel: () => void;
  onConfirm: () => void;
  title: string;
};

export function ConfirmDialog({
  cancelLabel = "Cancelar",
  confirmLabel = "Confirmar",
  description,
  onCancel,
  onConfirm,
  title,
}: ConfirmDialogProps) {
  const cancelButton = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    cancelButton.current?.focus();
    function closeWithEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", closeWithEscape);
    return () => document.removeEventListener("keydown", closeWithEscape);
  }, [onCancel]);

  return (
    <div className="confirm-backdrop" role="presentation">
      <section
        aria-describedby="confirm-dialog-description"
        aria-labelledby="confirm-dialog-title"
        aria-modal="true"
        className="confirm-dialog"
        role="dialog"
      >
        <p className="eyebrow">Confirmação</p>
        <h2 id="confirm-dialog-title">{title}</h2>
        <p id="confirm-dialog-description">{description}</p>
        <footer className="confirm-dialog-actions">
          <button
            className="button button-secondary"
            onClick={onCancel}
            ref={cancelButton}
            type="button"
          >
            {cancelLabel}
          </button>
          <button className="button button-danger" onClick={onConfirm} type="button">
            {confirmLabel}
          </button>
        </footer>
      </section>
    </div>
  );
}
