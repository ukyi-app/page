import { Dialog as BaseDialog } from "@base-ui-components/react/dialog";
import type { ComponentProps } from "react";
import { CloseIcon } from "../../lib/icons";
import { cn } from "../../lib/utils";

export const Dialog = BaseDialog.Root;
export const DialogTrigger = BaseDialog.Trigger;
export const DialogClose = BaseDialog.Close;

export function DialogContent({
  className,
  children,
  showClose = true,
  ...props
}: ComponentProps<typeof BaseDialog.Popup> & { showClose?: boolean }) {
  return (
    <BaseDialog.Portal>
      <BaseDialog.Backdrop
        className={cn(
          "fixed inset-0 z-50 bg-black/70 backdrop-blur-sm",
          "transition-opacity duration-200 data-[starting-style]:opacity-0 data-[ending-style]:opacity-0",
        )}
      />
      <BaseDialog.Popup
        className={cn(
          "fixed left-1/2 top-1/2 z-50 grid w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4",
          "rounded-xl border border-border bg-popover p-6 text-popover-foreground shadow-2xl shadow-black/50",
          "transition-all duration-200 data-[starting-style]:opacity-0 data-[starting-style]:scale-95 data-[ending-style]:opacity-0 data-[ending-style]:scale-95",
          className,
        )}
        {...props}
      >
        {children}
        {showClose && (
          <BaseDialog.Close
            className="absolute right-4 top-4 rounded-md p-1 text-muted-foreground opacity-70 outline-none transition-opacity hover:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/60"
            aria-label="닫기"
          >
            <CloseIcon className="size-4" />
          </BaseDialog.Close>
        )}
      </BaseDialog.Popup>
    </BaseDialog.Portal>
  );
}

export function DialogHeader({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("flex flex-col gap-1.5 pr-6", className)} {...props} />;
}

export function DialogFooter({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)} {...props} />;
}

export function DialogTitle({ className, ...props }: ComponentProps<typeof BaseDialog.Title>) {
  return <BaseDialog.Title className={cn("text-base font-semibold tracking-tight", className)} {...props} />;
}

export function DialogDescription({ className, ...props }: ComponentProps<typeof BaseDialog.Description>) {
  return (
    <BaseDialog.Description className={cn("text-sm leading-relaxed text-muted-foreground", className)} {...props} />
  );
}
