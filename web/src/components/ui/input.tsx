import { Input as BaseInput } from "@base-ui-components/react/input";
import type { ComponentProps } from "react";
import { cn } from "../../lib/utils";

export function Input({ className, ...props }: ComponentProps<typeof BaseInput>) {
  return (
    <BaseInput
      className={cn(
        "flex h-9 w-full rounded-md border border-input bg-background/60 px-3 py-1 text-sm shadow-sm transition-colors",
        "placeholder:text-muted-foreground/70",
        "focus-visible:outline-none focus-visible:border-ring/60 focus-visible:ring-2 focus-visible:ring-ring/30",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}
