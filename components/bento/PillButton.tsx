/**
 * `PillButton` — the full-pill CTA / chip / badge button primitive (Req 13.1;
 * steering §4, §8, §11, §12).
 *
 * Fully-rounded (`9999px`) per steering §4. Three variants map to the system's
 * surface roles without hardcoding hex (steering §12):
 *   - `solid`   → dark espresso pill with on-dark text (primary CTA, steering §2)
 *   - `soft`    → warm oat muted surface (secondary)
 *   - `outline` → transparent with a hairline border
 *
 * Micro-interaction timing (150ms) follows steering §8; a visible
 * `:focus-visible` outline is provided for keyboard navigation (steering §6, §11).
 */

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { RADIUS_PILL } from "@/lib/bento";

export type PillButtonVariant = "solid" | "soft" | "outline";
export type PillButtonSize = "sm" | "md";

export interface PillButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: PillButtonVariant;
  size?: PillButtonSize;
  /** Optional leading icon (steering §10 — single consistent icon set). */
  icon?: ReactNode;
  children?: ReactNode;
}

const VARIANT_CLASSES: Record<PillButtonVariant, string> = {
  solid: "bg-bg-rail text-text-on-dark hover:opacity-90",
  soft: "bg-bg-surface-muted text-text-primary hover:brightness-95",
  outline:
    "bg-transparent text-text-primary border border-border-subtle hover:bg-bg-surface-muted",
};

const SIZE_CLASSES: Record<PillButtonSize, string> = {
  sm: "px-3 py-1 text-sm gap-1.5",
  md: "px-4 py-2 text-sm gap-2",
};

export default function PillButton({
  variant = "solid",
  size = "md",
  icon,
  children,
  className = "",
  type = "button",
  ...rest
}: PillButtonProps) {
  return (
    <button
      type={type}
      data-pill-button=""
      data-variant={variant}
      style={{ borderRadius: RADIUS_PILL }}
      className={[
        "inline-flex items-center justify-center font-sans font-medium",
        "transition-[opacity,filter,background-color] duration-150",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-text-primary",
        "disabled:cursor-not-allowed disabled:opacity-50",
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        className,
      ].join(" ")}
      {...rest}
    >
      {icon && (
        <span aria-hidden className="inline-flex items-center">
          {icon}
        </span>
      )}
      {children}
    </button>
  );
}
