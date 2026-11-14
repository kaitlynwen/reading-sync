/**
 * Warm Editorial Bento primitives (Req 13.1; steering §12).
 *
 * Reusable layout primitives consumed by the Group Reading Room redesign
 * (task 14.2) instead of re-styling raw `<div>`s. Pure geometry/token helpers
 * live in `@/lib/bento`.
 */

export { default as BentoCard } from "./BentoCard";
export type { BentoCardProps } from "./BentoCard";

export { default as BookCover } from "./BookCover";
export type { BookCoverProps } from "./BookCover";

export { default as ProgressTrack } from "./ProgressTrack";
export type {
  ProgressTrackProps,
  ProgressTrackMember,
} from "./ProgressTrack";

export { default as PillButton } from "./PillButton";
export type {
  PillButtonProps,
  PillButtonVariant,
  PillButtonSize,
} from "./PillButton";

export { default as Stepper } from "./Stepper";
export type { StepperProps } from "./Stepper";

export { default as MonogramAvatar } from "./MonogramAvatar";
export type { MonogramAvatarProps } from "./MonogramAvatar";
