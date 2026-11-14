/**
 * `BentoCard` — the core surface primitive of the Warm Editorial Bento system
 * (Req 13.1; steering §4, §12).
 *
 * A single rounded card with a hairline border. Everything else — the Group
 * Reading Room screens (task 14.2) — composes these instead of re-styling raw
 * `<div>`s (steering §12, Reusable Bento Primitives).
 *
 * Geometry comes exclusively from Design_Tokens via `lib/bento.ts`:
 *   - radius: 18px primary / 12px inner (`tone`)
 *   - border: 1px hairline (`--border-subtle`) or strong (`--border-strong`)
 *   - padding: 20px min / 24px max (steering §4)
 *
 * No hex colors are written here (steering §12).
 */

import type { CSSProperties, ElementType, ReactNode } from "react";
import {
  BORDER_HAIRLINE,
  BORDER_STRONG,
  CARD_PADDING_MAX,
  CARD_PADDING_MIN,
  RADIUS_CARD,
  RADIUS_INNER,
  SHADOW_FLOAT,
  accentVar,
  type BentoAccent,
} from "@/lib/bento";

export interface BentoCardProps {
  /** `"primary"` → 18px radius bento card; `"inner"` → 12px sub-card. */
  tone?: "primary" | "inner";
  /** Internal padding: `"comfortable"` (24px) or `"compact"` (20px). */
  padding?: "comfortable" | "compact" | "none";
  /** Optional pastel accent fill for category/stat/banner tiles (steering §2). */
  accent?: BentoAccent;
  /** Use the stronger hairline (active/focused surfaces, steering §2). */
  strongBorder?: boolean;
  /** Add the soft float shadow (popovers/modals/quick-log, steering §4). */
  floating?: boolean;
  /** Element to render as; defaults to a `<div>`. */
  as?: ElementType;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}

export default function BentoCard({
  tone = "primary",
  padding = "comfortable",
  accent,
  strongBorder = false,
  floating = false,
  as,
  className = "",
  style,
  children,
  ...rest
}: BentoCardProps & Record<string, unknown>) {
  const Tag: ElementType = as ?? "div";

  const resolvedPadding =
    padding === "none"
      ? undefined
      : padding === "compact"
        ? CARD_PADDING_MIN
        : CARD_PADDING_MAX;

  const cardStyle: CSSProperties = {
    borderRadius: tone === "inner" ? RADIUS_INNER : RADIUS_CARD,
    border: strongBorder ? BORDER_STRONG : BORDER_HAIRLINE,
    padding: resolvedPadding,
    background: accent ? accentVar(accent) : "var(--bg-surface)",
    boxShadow: floating ? SHADOW_FLOAT : undefined,
    ...style,
  };

  return (
    <Tag
      data-bento-card=""
      data-tone={tone}
      data-accent={accent}
      style={cardStyle}
      className={className}
      {...rest}
    >
      {children}
    </Tag>
  );
}
