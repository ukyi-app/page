import { Toast as BaseToast } from "@base-ui-components/react/toast";
import { CloseIcon } from "../../lib/icons";
import { cn } from "../../lib/utils";

export const ToastProvider = BaseToast.Provider;

function accentFor(type: string | undefined): string {
  switch (type) {
    case "success":
      return "before:bg-success";
    case "error":
      return "before:bg-destructive";
    default:
      return "before:bg-primary";
  }
}

export function Toaster() {
  const { toasts } = BaseToast.useToastManager();
  return (
    <BaseToast.Portal>
      <BaseToast.Viewport className="fixed bottom-4 right-4 z-[70] flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-2 outline-none">
        {toasts.map((toast) => (
          <BaseToast.Root
            key={toast.id}
            toast={toast}
            className={cn(
              "relative flex items-start gap-3 overflow-hidden rounded-lg border border-border bg-popover/95 py-3 pl-4 pr-9 shadow-xl shadow-black/40 backdrop-blur",
              "before:absolute before:inset-y-0 before:left-0 before:w-1",
              "transition-all duration-200 data-[starting-style]:translate-x-4 data-[starting-style]:opacity-0 data-[ending-style]:translate-x-4 data-[ending-style]:opacity-0",
              accentFor(toast.type),
            )}
          >
            <div className="min-w-0 flex-1">
              <BaseToast.Title className="text-sm font-semibold leading-tight tracking-tight" />
              <BaseToast.Description className="mt-1 break-words text-xs leading-relaxed text-muted-foreground" />
            </div>
            <BaseToast.Close
              className="absolute right-2 top-2.5 rounded p-1 text-muted-foreground opacity-60 outline-none transition-opacity hover:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/50"
              aria-label="닫기"
            >
              <CloseIcon className="size-3.5" />
            </BaseToast.Close>
          </BaseToast.Root>
        ))}
      </BaseToast.Viewport>
    </BaseToast.Portal>
  );
}

export function useToast() {
  const manager = BaseToast.useToastManager();
  return {
    ...manager,
    success: (title: string, description?: string) => manager.add({ title, description, type: "success" }),
    error: (title: string, description?: string) => manager.add({ title, description, type: "error" }),
    info: (title: string, description?: string) => manager.add({ title, description, type: "info" }),
  };
}
