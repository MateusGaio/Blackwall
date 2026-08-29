// MIT License — Copyright (c) 2026 Mateus Gaio

import { Button } from "@/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";

type ConfirmDialogProps = {
  cancelLabel?: string;
  confirmLabel?: string;
  dontAskAgain?: boolean;
  dontAskAgainLabel?: string;
  description: string;
  headingLabel?: string;
  onCancel: () => void;
  onConfirm: () => void;
  onDontAskAgainChange?: (checked: boolean) => void;
  title: string;
};

/** Confirmação modal para ações destrutivas (UX_SPEC §9): sem desfazer após confirmar. */
export function ConfirmDialog({
  cancelLabel = "Cancelar",
  confirmLabel = "Confirmar",
  dontAskAgain = false,
  dontAskAgainLabel,
  description,
  headingLabel = "Confirmação",
  onCancel,
  onConfirm,
  onDontAskAgainChange,
  title,
}: ConfirmDialogProps) {
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <DialogContent className="max-w-md" showCloseButton={false}>
        <DialogHeader>
          {headingLabel && (
            <p className="font-mono text-[0.7rem] uppercase tracking-[0.08em] text-muted-foreground">
              {headingLabel}
            </p>
          )}
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {dontAskAgainLabel && onDontAskAgainChange && (
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              checked={dontAskAgain}
              className="size-3.5 accent-foreground"
              onChange={(event) => onDontAskAgainChange(event.target.checked)}
              type="checkbox"
            />
            <span>{dontAskAgainLabel}</span>
          </label>
        )}
        <DialogFooter className="sm:justify-end">
          <Button autoFocus onClick={onCancel} variant="secondary">
            {cancelLabel}
          </Button>
          <Button onClick={onConfirm} variant="destructive">
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
