import { Tabs as BaseTabs } from "@base-ui-components/react/tabs";
import type { ComponentProps } from "react";
import { cn } from "../../lib/utils";

export const Tabs = BaseTabs.Root;

export function TabsList({ className, ...props }: ComponentProps<typeof BaseTabs.List>) {
  return (
    <BaseTabs.List
      className={cn(
        "relative inline-flex h-9 items-center gap-1 rounded-lg border border-border bg-secondary/60 p-1",
        className,
      )}
      {...props}
    />
  );
}

export function TabsTab({ className, ...props }: ComponentProps<typeof BaseTabs.Tab>) {
  return (
    <BaseTabs.Tab
      className={cn(
        "inline-flex h-7 select-none items-center gap-1.5 rounded-md px-3 text-sm font-medium text-muted-foreground outline-none transition-colors",
        "hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50",
        "data-[selected]:bg-card data-[selected]:text-foreground data-[selected]:shadow-sm",
        className,
      )}
      {...props}
    />
  );
}

export function TabsPanel({ className, ...props }: ComponentProps<typeof BaseTabs.Panel>) {
  return <BaseTabs.Panel className={cn("outline-none", className)} {...props} />;
}
