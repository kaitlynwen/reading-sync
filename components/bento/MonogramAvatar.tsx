/**
 * `MonogramAvatar` — a circular avatar that shows a member's photo, or a
 * deterministic pastel monogram when no photo is available (Req 13.1; steering
 * §10).
 *
 * The monogram's accent fill is chosen deterministically from the member key so
 * each member keeps a stable color, with `--text-primary` initials for contrast
 * (steering §10, §11). A 2px ring (`--bg-surface`) separates overlapping avatars
 * cleanly on the shared progress track (steering §10).
 */

import type { CSSProperties } from "react";
import {
  AVATAR_RING,
  AVATAR_SIZE,
  accentVar,
  initialsFromName,
  monogramAccent,
  type BentoAccent,
} from "@/lib/bento";

export interface MonogramAvatarProps {
  /** Member display name — source of the monogram initials. */
  name: string;
  /**
   * Stable key used to pick the deterministic accent. Defaults to the name;
   * pass a user id when available so renames keep the same color.
   */
  colorKey?: string;
  /** Optional profile photo URL; when present it replaces the monogram. */
  src?: string | null;
  /** Diameter in pixels; defaults to the 28px track avatar size (steering §5). */
  size?: number;
  /** Force a specific accent (rarely needed; overrides the deterministic pick). */
  accent?: BentoAccent;
  /** Render the 2px separating ring (on by default for overlap, steering §10). */
  ring?: boolean;
  className?: string;
  style?: CSSProperties;
}

export default function MonogramAvatar({
  name,
  colorKey,
  src,
  size = AVATAR_SIZE,
  accent,
  ring = true,
  className = "",
  style,
}: MonogramAvatarProps) {
  const resolvedAccent = accent ?? monogramAccent(colorKey ?? name);
  const initials = initialsFromName(name);
  const hasPhoto = typeof src === "string" && src.length > 0;

  const baseStyle: CSSProperties = {
    width: size,
    height: size,
    borderRadius: "9999px",
    border: ring ? AVATAR_RING : undefined,
    overflow: "hidden",
    ...style,
  };

  if (hasPhoto) {
    return (
      <span
        data-monogram-avatar=""
        role="img"
        aria-label={name}
        title={name}
        style={baseStyle}
        className={`inline-flex items-center justify-center ${className}`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- arbitrary
            remote avatar URLs; plain <img> keeps the primitive portable. */}
        <img src={src as string} alt={name} className="h-full w-full object-cover" />
      </span>
    );
  }

  return (
    <span
      data-monogram-avatar=""
      data-accent={resolvedAccent}
      role="img"
      aria-label={name}
      title={name}
      style={{
        ...baseStyle,
        background: accentVar(resolvedAccent),
        color: "var(--text-primary)",
        fontSize: Math.max(10, Math.round(size * 0.4)),
      }}
      className={`inline-flex items-center justify-center font-sans font-semibold leading-none ${className}`}
    >
      {initials}
    </span>
  );
}
