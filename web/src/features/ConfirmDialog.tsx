import { useState, type ReactNode } from "react";
import { Button } from "../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import { SpinnerIcon } from "../lib/icons";

export type ConfirmDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  variant?: "default" | "destructive";
  /** 성공 시 resolve → 닫힘. 실패 시 reject(호출자가 토스트) → 열린 상태 유지. */
  onConfirm: () => Promise<void>;
};

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  variant = "default",
  onConfirm,
}: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false);

  async function handle() {
    if (busy) return;
    setBusy(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch {
      // 호출자가 토스트로 처리. 다이얼로그는 유지.
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="max-w-md" showClose={!busy}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="mt-2">
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
            취소
          </Button>
          <Button variant={variant === "destructive" ? "destructive" : "default"} onClick={handle} disabled={busy}>
            {busy ? <SpinnerIcon className="size-4" /> : null}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
