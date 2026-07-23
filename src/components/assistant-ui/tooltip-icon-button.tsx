"use client";

import { forwardRef, type ComponentPropsWithRef, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type TooltipIconButtonProps = ComponentPropsWithRef<typeof Button> & {
  tooltip: string;
  side?: "top" | "bottom" | "left" | "right";
  children: ReactNode;
};

export const TooltipIconButton = forwardRef<
  HTMLButtonElement,
  TooltipIconButtonProps
>(({ children, tooltip, className, side: _side = "bottom", ...rest }, ref) => {
  void _side;
  return (
    <Button
      variant="ghost"
      size="icon"
      title={tooltip}
      aria-label={tooltip}
      className={cn(
        "size-7 text-[var(--muted)] hover:bg-[var(--elevated)] hover:text-[var(--text)] active:scale-95",
        className,
      )}
      ref={ref}
      {...rest}
    >
      {children}
      <span className="sr-only">{tooltip}</span>
    </Button>
  );
});
TooltipIconButton.displayName = "TooltipIconButton";
