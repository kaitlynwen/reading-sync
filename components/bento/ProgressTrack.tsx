/**
 * `ProgressTrack` — the single shared horizontal reading track (Req 13.1; the
 * geometry 14.2's Req 13.4 relies on; steering §5).
 *
 * Renders a 0%–100% track with each member's {@link MonogramAvatar} pinned to
 * their completed count as a percentage of the shared goal, plus an optional
 * vertical dashed club-target marker at the goal checkpoint. Positions are
 * computed by the pure `toTrackPercent` helper so they are clamped to the track
 * and independently testable.
 *
 * Accessibility (steering §11): the track exposes `role="progressbar"` with a
 * readable `aria-valuetext`. Consumers that know the chapter labels can pass a
 * richer `aria-valuetext` via `valueText`.
 */

import type { CSSProperties } from "react";
import { RADIUS_PILL, toTrackPercent } from "@/lib/bento";
import MonogramAvatar from "./MonogramAvatar";
import type { BentoAccent } from "@/lib/bento";

export interface ProgressTrackMember {
  /** Stable id used as the React key and the avatar color key. */
  id: string;
  /** Display name for the avatar monogram + label. */
  name: string;
  /** This member's completed count (chapters/pages/units). */
  completed: number;
  /** Optional profile photo URL. */
  avatarUrl?: string | null;
  /** Optional forced accent for the monogram. */
  accent?: BentoAccent;
}

export interface ProgressTrackProps {
  /** Members to pin onto the track. */
  members: ProgressTrackMember[];
  /** Shared goal that maps a completed count to a 0–100% position. */
  goal: number;
  /** Optional dashed club-target marker position, as a completed count. */
  targetMarker?: number | null;
  /** Avatar diameter in pixels (defaults to the 28px steering size). */
  avatarSize?: number;
  /** Fully-formed accessible value text (steering §11). */
  valueText?: string;
  className?: string;
  style?: CSSProperties;
}

export default function ProgressTrack({
  members,
  goal,
  targetMarker = null,
  avatarSize = 28,
  valueText,
  className = "",
  style,
}: ProgressTrackProps) {
  const hasTarget =
    typeof targetMarker === "number" && Number.isFinite(targetMarker);
  const targetPercent = hasTarget ? toTrackPercent(targetMarker as number, goal) : 0;

  // Average completion across members for the progressbar's numeric value.
  const avgPercent =
    members.length === 0
      ? 0
      : members.reduce((sum, m) => sum + toTrackPercent(m.completed, goal), 0) /
        members.length;

  const containerStyle: CSSProperties = {
    // Reserve vertical room for the avatars that overhang the slim rail.
    paddingBlock: avatarSize / 2,
    ...style,
  };

  return (
    <div
      data-progress-track=""
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(avgPercent)}
      aria-valuetext={valueText ?? `${Math.round(avgPercent)}% complete`}
      style={containerStyle}
      className={`relative w-full ${className}`}
    >
      {/* The rail itself (0%–100%). */}
      <div
        data-track-rail=""
        style={{ borderRadius: RADIUS_PILL }}
        className="h-1.5 w-full bg-bg-surface-muted"
      />

      {/* Vertical dashed club-target marker (steering §5). */}
      {hasTarget && (
        <div
          data-track-target-marker=""
          aria-hidden
          style={{
            left: `${targetPercent}%`,
            borderLeft: "2px dashed var(--border-strong)",
          }}
          className="absolute top-0 bottom-0 -translate-x-1/2"
        />
      )}

      {/* Member avatars pinned at their completed-count percentage. */}
      {members.map((member) => {
        const percent = toTrackPercent(member.completed, goal);
        return (
          <div
            key={member.id}
            data-track-avatar=""
            data-percent={percent}
            style={{
              left: `${percent}%`,
              top: "50%",
              transform: "translate(-50%, -50%)",
            }}
            className="absolute"
          >
            <MonogramAvatar
              name={member.name}
              colorKey={member.id}
              src={member.avatarUrl}
              accent={member.accent}
              size={avatarSize}
            />
          </div>
        );
      })}
    </div>
  );
}
