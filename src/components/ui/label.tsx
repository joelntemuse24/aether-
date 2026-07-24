import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Label({
  children,
  accent,
  className,
}: {
  children: ReactNode;
  accent?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "font-[family-name:var(--font-sc)] text-[10px] font-medium uppercase tracking-[0.14em]",
        accent ? "text-[var(--accent)]" : "text-[var(--muted-soft)]",
        className,
      )}
    >
      {children}
    </span>
  );
}
