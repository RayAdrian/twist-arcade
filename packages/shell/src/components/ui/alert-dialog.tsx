// packages/shell/src/components/ui/alert-dialog.tsx — minimal shadcn-style wrapper over
// @radix-ui/react-alert-dialog. Used by ControlsRow's restart confirm ("Restart? This game
// will be lost", plan §4.9) — an alert dialog (not a plain Dialog) because it demands an
// explicit choice rather than being dismissible by an outside click alone.
"use client";

import * as React from "react";
import * as AlertDialogPrimitive from "@radix-ui/react-alert-dialog";
import { cn } from "../../lib/cn";

export const AlertDialog = AlertDialogPrimitive.Root;
export const AlertDialogTrigger = AlertDialogPrimitive.Trigger;
export const AlertDialogPortal = AlertDialogPrimitive.Portal;

export function AlertDialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Overlay>) {
  return <AlertDialogPrimitive.Overlay className={cn("fixed inset-0 z-50 bg-ink/40", className)} {...props} />;
}

export function AlertDialogContent({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Content>) {
  return (
    <AlertDialogPortal>
      <AlertDialogOverlay />
      <AlertDialogPrimitive.Content
        className={cn(
          "fixed left-1/2 top-1/2 z-50 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-lg border border-ink-muted bg-paper p-6 text-ink shadow-lg",
          className
        )}
        {...props}
      />
    </AlertDialogPortal>
  );
}

export const AlertDialogTitle = AlertDialogPrimitive.Title;
export const AlertDialogDescription = AlertDialogPrimitive.Description;
export const AlertDialogAction = AlertDialogPrimitive.Action;
export const AlertDialogCancel = AlertDialogPrimitive.Cancel;
