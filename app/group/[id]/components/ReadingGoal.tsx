"use client";

import { useState } from "react";
import { BentoCard, PillButton } from "@/components/bento";
import type { ReadingSession } from "../types";

type ReadingGoalProps = {
  currentSession: ReadingSession | undefined;
  myProgress: number;
  onUpdateGoal: (
    goalType: string,
    goalAmount: number | null,
    goalUnit: string | null
  ) => Promise<void>;
};

function getUnitLabel(progressType: string | undefined) {
  if (progressType === "pages") return "pages";
  if (progressType === "milestones") return "milestones";
  if (progressType === "sections") return "sections";
  return "chapters";
}

function getGoalLabel(currentSession: ReadingSession, amount: number) {
  if (currentSession.progress_type === "pages") return `Page ${amount}`;

  if (
    currentSession.progress_type === "milestones" ||
    currentSession.progress_type === "sections"
  ) {
    const unit = currentSession.reading_units.find(
      (readingUnit) => readingUnit.order_index === amount
    );

    if (unit) return unit.label;

    const fallback =
      currentSession.progress_type === "sections" ? "Section" : "Milestone";
    return `${fallback} ${amount}`;
  }

  return `Chapter ${amount}`;
}

export default function ReadingGoal({
  currentSession,
  myProgress,
  onUpdateGoal,
}: ReadingGoalProps) {
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState("2");
  const [saving, setSaving] = useState(false);
  const [localMessage, setLocalMessage] = useState("");

  if (!currentSession) return null;

  const unit = getUnitLabel(currentSession.progress_type);
  const hasReachedGoal =
    currentSession.goal_type === "target" &&
    currentSession.goal_amount !== null &&
    myProgress >= currentSession.goal_amount;
  const goalLabel =
    currentSession.goal_amount !== null
      ? getGoalLabel(currentSession, currentSession.goal_amount)
      : null;

  function startEditing() {
    if (!currentSession) return;

    setAmount(
      currentSession.goal_amount ? String(currentSession.goal_amount) : ""
    );
    setLocalMessage("");
    setEditing(true);
  }

  // Preserve the set-goal behavior (Req 13.7): validate a positive whole
  // number locally, then delegate the write to the handler.
  async function saveGoal() {
    const parsedAmount = Number(amount);

    if (!Number.isInteger(parsedAmount) || parsedAmount <= 0) {
      setLocalMessage("Enter a positive whole number.");
      return;
    }

    setSaving(true);
    setLocalMessage("");

    await onUpdateGoal("target", parsedAmount, unit);

    setSaving(false);
    setEditing(false);
  }

  // Preserve the clear-goal behavior (Req 13.7): store a "no schedule" goal.
  async function saveNoSchedule() {
    setSaving(true);
    setLocalMessage("");

    await onUpdateGoal("none", null, null);

    setSaving(false);
    setEditing(false);
  }

  return (
    <BentoCard
      as="section"
      accent="lavender"
      className="flex flex-col gap-4"
    >
      <p className="font-sans text-xs font-semibold uppercase tracking-widest text-text-primary">
        Current Goal
      </p>

      {!editing ? (
        <div className="flex flex-col gap-4">
          {currentSession.goal_type === "target" && goalLabel ? (
            <p className="font-serif text-lg font-semibold text-text-primary">
              Goal: {goalLabel}
            </p>
          ) : (
            <p className="font-sans text-text-primary">No reading goal set.</p>
          )}

          {hasReachedGoal && (
            <div
              role="status"
              className="rounded-[var(--radius-inner)] border border-border-subtle bg-bg-surface p-3 font-sans text-sm text-text-primary"
            >
              You reached the goal.
            </div>
          )}

          <div>
            <PillButton onClick={startEditing}>Set Goal</PillButton>
          </div>
        </div>
      ) : (
        <BentoCard
          tone="inner"
          padding="compact"
          className="flex flex-col gap-4"
        >
          <p className="font-sans font-medium text-text-primary">Set goal</p>

          <div className="flex items-center gap-2">
            <span className="font-sans text-sm text-text-primary">Reach:</span>

            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-20 rounded-[var(--radius-inner)] border border-border-strong bg-bg-surface p-2 text-center font-sans tabular-nums text-text-primary"
            />
          </div>

          <div className="flex flex-col gap-2">
            <PillButton
              onClick={saveGoal}
              disabled={saving}
              className="w-full"
            >
              Save Goal
            </PillButton>

            <PillButton
              variant="outline"
              onClick={saveNoSchedule}
              disabled={saving}
              className="w-full"
            >
              No schedule
            </PillButton>

            <button
              type="button"
              onClick={() => setEditing(false)}
              disabled={saving}
              className="font-sans text-sm text-text-secondary underline disabled:opacity-50"
            >
              Cancel
            </button>

            {localMessage && (
              <p className="text-center font-sans text-sm text-text-primary">
                {localMessage}
              </p>
            )}
          </div>
        </BentoCard>
      )}
    </BentoCard>
  );
}
