// packages/shell/src/components/ui/popover.tsx — minimal shadcn-style wrapper over
// @radix-ui/react-popover. Used by CalloutLayer (plan §4.15): anchored, non-modal,
// no focus trap, no scrim, role="status".

import * as React from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { cn } from "../../lib/cn";

export const Popover = PopoverPrimitive.Root;
export const PopoverAnchor = PopoverPrimitive.Anchor;

export function PopoverContent({
  className,
  align = "center",
  sideOffset = 8,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        align={align}
        sideOffset={sideOffset}
        // Non-modal, no focus trap (plan §4.15) — Radix Popover doesn't trap focus by
        // default (Dialog does), which is exactly the behavior CalloutLayer needs: it must
        // never block board input.
        className={cn(
          "z-40 max-w-xs rounded-md border border-ink-muted bg-paper px-3 py-2 text-sm text-ink shadow-md",
          className
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}
