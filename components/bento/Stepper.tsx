/**
 * `Stepper` — the frictionless inline progress stepper primitive (Req 13.1; the
 * single-interaction increment of Req 13.6; steering §5, §11).
 *
 * Keeps progress logging inline: a label (e.g. `+10 pages` / `Next Chapter`),
 * the current value rendered with tabular numerals so it never jitters
 * (steering §3), and decrement/increment controls — each a single interaction
 * that does not navigate away (Req 13.6). The actual mutation is owned by the
 * consumer via `onIncrement` / `onDecrement`; this primitive only renders the
 * control and is pure/stateless.
 *
 * Icon-only controls carry explicit `aria-label`s and native tooltips
 * (steering §11).
 */

import PillButton from "./PillButton";

export interface StepperProps {
  /** Current progress value, rendered with tabular numerals. */
  value: number;
  /** Short unit label shown after the value (e.g. "pages", "ch."). */
  unitLabel?: string;
  /** Step size reflected in the control labels (e.g. 10 → "+10"). */
  step?: number;
  /** Invoked on a single increment interaction (Req 13.6). */
  onIncrement?: () => void;
  /** Invoked on a single decrement interaction. */
  onDecrement?: () => void;
  /** Disable the decrement control (e.g. already at 0). */
  canDecrement?: boolean;
  /** Disable the increment control (e.g. already at goal). */
  canIncrement?: boolean;
  /** Accessible name for the stepper group. */
  ariaLabel?: string;
  className?: string;
}

export default function Stepper({
  value,
  unitLabel,
  step = 1,
  onIncrement,
  onDecrement,
  canDecrement = true,
  canIncrement = true,
  ariaLabel = "Update progress",
  className = "",
}: StepperProps) {
  const decLabel = `Decrease by ${step}${unitLabel ? ` ${unitLabel}` : ""}`;
  const incLabel = `Increase by ${step}${unitLabel ? ` ${unitLabel}` : ""}`;

  return (
    <div
      data-stepper=""
      role="group"
      aria-label={ariaLabel}
      className={`inline-flex items-center gap-2 ${className}`}
    >
      <PillButton
        size="sm"
        variant="soft"
        aria-label={decLabel}
        title={decLabel}
        disabled={!canDecrement}
        onClick={onDecrement}
      >
        −{step}
      </PillButton>

      <span
        data-stepper-value=""
        data-numeric
        className="min-w-10 text-center font-sans text-sm font-semibold tabular-nums text-text-primary"
      >
        {value}
        {unitLabel ? ` ${unitLabel}` : ""}
      </span>

      <PillButton
        size="sm"
        variant="solid"
        aria-label={incLabel}
        title={incLabel}
        disabled={!canIncrement}
        onClick={onIncrement}
      >
        +{step}
      </PillButton>
    </div>
  );
}
