"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  BentoCard,
  BookCover,
  PillButton,
  ProgressTrack,
  Stepper,
} from "@/components/bento";
import type { ProgressTrackMember } from "@/components/bento";
import { toTrackPercent } from "@/lib/bento";
import type { ReadingSession, Member } from "../types";

type CurrentBookProps = {
  groupId: string;
  members: Member[];
  currentSession: ReadingSession | undefined;
  myProgress: number;
  message: string;
  getMemberProgress: (userId: string) => number;
  onCompleteChapter: () => void;
  onUndoChapter: () => void;
  onSetProgress: (value: number) => void;
  onDeleteBook: () => void;
};

function getProgressNoun(progressType: string | undefined) {
  if (progressType === "pages") return "page";
  if (progressType === "milestones") return "milestone";
  if (progressType === "sections") return "section";
  return "chapter";
}

function getProgressNounPlural(progressType: string | undefined) {
  if (progressType === "pages") return "pages";
  if (progressType === "milestones") return "milestones";
  if (progressType === "sections") return "sections";
  return "chapters";
}

function capitalize(word: string) {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

export default function CurrentBook({
  groupId,
  members,
  currentSession,
  myProgress,
  message,
  getMemberProgress,
  onCompleteChapter,
  onUndoChapter,
  onSetProgress,
  onDeleteBook,
}: CurrentBookProps) {
  const [sliderValue, setSliderValue] = useState(myProgress);

  useEffect(() => {
    setSliderValue(myProgress);
  }, [myProgress]);

  if (!currentSession) {
    // Empty state preserves the "start reading" entry point (steering §9).
    return (
      <BentoCard as="section" accent="peach" className="flex flex-col gap-4">
        <p className="font-serif text-lg text-text-primary">
          Your club&apos;s shelf is empty — pick your next read together.
        </p>

        <div>
          <Link
            href={`/group/${groupId}/create-session`}
            className="inline-flex items-center justify-center rounded-[var(--radius-pill)] bg-bg-rail px-4 py-2 font-sans text-sm font-medium text-text-on-dark transition-[opacity] duration-150 hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-text-primary"
          >
            Start Reading
          </Link>
        </div>
      </BentoCard>
    );
  }

  const noun = getProgressNoun(currentSession.progress_type);
  const pluralNoun = getProgressNounPlural(currentSession.progress_type);
  const isPageMode = currentSession.progress_type === "pages";

  const isFinished = myProgress >= currentSession.total_chapters;
  const canUndo = myProgress > 0;

  const everyoneFinished = members.every(
    (member) =>
      getMemberProgress(member.user_id) >= currentSession.total_chapters
  );

  const myPercent = toTrackPercent(myProgress, currentSession.total_chapters);

  const lowestProgress =
    members.length > 0
      ? Math.min(...members.map((member) => getMemberProgress(member.user_id)))
      : 0;

  const groupNextProgress = Math.min(
    lowestProgress + 1,
    currentSession.total_chapters
  );

  const readyThreshold = groupNextProgress - 1;

  const readyMembers = members.filter(
    (member) => getMemberProgress(member.user_id) >= readyThreshold
  );

  const waitingMembers = members.filter(
    (member) => getMemberProgress(member.user_id) < readyThreshold
  );

  // The shared horizontal track spans 0%–100% of the book, with each member's
  // avatar pinned at their completed-count percentage (Req 13.4).
  const trackMembers: ProgressTrackMember[] = members.map((member) => ({
    id: member.user_id,
    name: member.display_name,
    completed: getMemberProgress(member.user_id),
  }));

  // The vertical dashed club-target marker sits at the shared goal when one is
  // set, otherwise at the book's end (Req 13.4).
  const sharedGoal =
    currentSession.goal_type === "target" &&
    currentSession.goal_amount !== null
      ? currentSession.goal_amount
      : null;
  const targetMarker = sharedGoal ?? currentSession.total_chapters;

  return (
    <BentoCard as="section" className="flex flex-col gap-6">
      {/* Hero: book cover at 2:3 (or placeholder) beside the title (Req 13.2, 13.3). */}
      <div className="flex gap-5">
        <BookCover
          src={currentSession.cover_url}
          title={currentSession.book_title}
          width={96}
          className="shrink-0"
        />

        <div className="flex flex-col gap-1">
          <p className="font-sans text-xs font-semibold uppercase tracking-widest text-text-secondary">
            Current Book
          </p>
          <h2 className="font-serif text-2xl font-semibold text-text-primary">
            {currentSession.book_title}
          </h2>
        </div>
      </div>

      {everyoneFinished ? (
        <div className="flex flex-col gap-3">
          <p className="font-serif text-lg font-semibold text-text-primary">
            🎉 Everyone finished this book.
          </p>
          <p className="font-sans text-text-secondary">
            Ready to start the next one.
          </p>

          <PillButton onClick={onDeleteBook} className="w-full">
            Start New Book
          </PillButton>
        </div>
      ) : (
        <>
          {/* Your own progress summary, rendered with tabular numerals (Req 13.5). */}
          <div className="flex flex-col gap-2">
            <div className="flex justify-between font-sans text-sm text-text-primary">
              <span>Your progress</span>
              <span data-numeric className="tabular-nums text-text-secondary">
                {myProgress} / {currentSession.total_chapters} {pluralNoun}
              </span>
            </div>

            <div
              className="h-1.5 w-full overflow-hidden rounded-[var(--radius-pill)] bg-bg-surface-muted"
              aria-hidden
            >
              <div
                className="h-full rounded-[var(--radius-pill)] bg-bg-rail"
                style={{ width: `${myPercent}%` }}
              />
            </div>
          </div>

          {/* Single shared horizontal track: every member avatar + dashed
              club-target marker at the shared goal (Req 13.4). */}
          <div className="flex flex-col gap-3">
            <p className="font-sans text-sm font-semibold text-text-primary">
              Ready for {capitalize(noun)}{" "}
              <span data-numeric className="tabular-nums">
                {groupNextProgress}
              </span>
            </p>

            <ProgressTrack
              members={trackMembers}
              goal={currentSession.total_chapters}
              targetMarker={targetMarker}
              valueText={`${Math.round(myPercent)}% complete`}
            />

            <div className="flex flex-wrap gap-2">
              {readyMembers.map((member) => (
                <span
                  key={member.user_id}
                  className="inline-flex items-center gap-1 rounded-[var(--radius-pill)] bg-bg-rail px-3 py-1 font-sans text-sm text-text-on-dark"
                >
                  ● {member.display_name}
                </span>
              ))}

              {waitingMembers.map((member) => (
                <span
                  key={member.user_id}
                  className="inline-flex items-center gap-1 rounded-[var(--radius-pill)] border border-border-subtle px-3 py-1 font-sans text-sm text-text-secondary"
                >
                  ○ {member.display_name}
                </span>
              ))}
            </div>

            {waitingMembers.length === 0 ? (
              <p className="font-sans text-sm text-text-primary">
                🎉 Everyone is ready!
              </p>
            ) : (
              <p className="font-sans text-sm text-text-secondary">
                Waiting on {waitingMembers.length}{" "}
                {waitingMembers.length === 1 ? "reader" : "readers"}.
              </p>
            )}
          </div>

          {isPageMode ? (
            // Page mode: frictionless inline stepper + explicit save, no
            // navigation away (Req 13.6).
            <BentoCard tone="inner" padding="compact" className="flex flex-col gap-3">
              <p className="font-sans text-sm font-semibold text-text-primary">
                Update your page
              </p>

              <div className="flex items-center justify-between gap-3">
                <Stepper
                  value={sliderValue}
                  unitLabel="pages"
                  ariaLabel="Update your page"
                  canDecrement={sliderValue > 0}
                  canIncrement={sliderValue < currentSession.total_chapters}
                  onDecrement={() =>
                    setSliderValue(Math.max(0, sliderValue - 1))
                  }
                  onIncrement={() =>
                    setSliderValue(
                      Math.min(currentSession.total_chapters, sliderValue + 1)
                    )
                  }
                />

                <span
                  data-numeric
                  className="font-sans text-sm tabular-nums text-text-secondary"
                >
                  Page {sliderValue} / {currentSession.total_chapters}
                </span>
              </div>

              <PillButton
                onClick={() => onSetProgress(sliderValue)}
                className="w-full"
              >
                Save Progress
              </PillButton>
            </BentoCard>
          ) : (
            // Chapter/unit mode: a single-interaction inline stepper completes
            // or undoes the next unit without navigating away (Req 13.6).
            <BentoCard tone="inner" padding="compact" className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex flex-col">
                  <span className="font-sans text-sm font-semibold text-text-primary">
                    {capitalize(pluralNoun)} read
                  </span>
                  <span
                    data-numeric
                    className="font-sans text-xs tabular-nums text-text-secondary"
                  >
                    {myProgress} / {currentSession.total_chapters}
                  </span>
                </div>

                <Stepper
                  value={myProgress}
                  ariaLabel={`Update ${pluralNoun} read`}
                  canDecrement={canUndo}
                  canIncrement={!isFinished}
                  onDecrement={onUndoChapter}
                  onIncrement={onCompleteChapter}
                />
              </div>

              {isFinished && (
                <p className="font-sans text-sm text-text-secondary">
                  Waiting for everyone else.
                </p>
              )}
            </BentoCard>
          )}

          <button
            type="button"
            onClick={onDeleteBook}
            className="self-start font-sans text-sm text-text-secondary underline"
          >
            Delete / Replace Book
          </button>
        </>
      )}

      {message && (
        <p className="font-sans text-sm text-text-primary">{message}</p>
      )}
    </BentoCard>
  );
}
