import { BentoCard, MonogramAvatar } from "@/components/bento";
import { toTrackPercent } from "@/lib/bento";
import type { Member, ReadingSession } from "../types";

type ProgressListProps = {
  members: Member[];
  currentSession: ReadingSession | undefined;
  getMemberProgress: (userId: string) => number;
};

function getProgressLabel(progressType: string | undefined) {
  if (progressType === "pages") return "pages";
  if (progressType === "milestones") return "milestones";
  if (progressType === "sections") return "sections";
  return "chapters";
}

export default function ProgressList({
  members,
  currentSession,
  getMemberProgress,
}: ProgressListProps) {
  const progressLabel = getProgressLabel(currentSession?.progress_type);
  const total = currentSession?.total_chapters ?? 0;

  return (
    <BentoCard as="section" className="flex flex-col gap-5">
      <h2 className="font-serif text-xl font-semibold text-text-primary">
        Everyone
      </h2>

      {/* Per-member progress list (Req 13.7 — preserved behavior). */}
      <ul className="flex flex-col gap-4">
        {members.map((member) => {
          const progress = getMemberProgress(member.user_id);
          const percent = toTrackPercent(progress, total);

          return (
            <li key={member.user_id} className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2 font-sans text-sm font-medium text-text-primary">
                  <MonogramAvatar
                    name={member.display_name}
                    colorKey={member.user_id}
                    size={24}
                  />
                  {member.display_name}
                </span>

                {currentSession ? (
                  <span
                    data-numeric
                    className="font-sans text-sm tabular-nums text-text-secondary"
                  >
                    {progress} / {total} {progressLabel}
                  </span>
                ) : (
                  <span className="font-sans text-sm text-text-secondary">
                    No book
                  </span>
                )}
              </div>

              {currentSession && (
                <div
                  className="h-1.5 w-full overflow-hidden rounded-[var(--radius-pill)] bg-bg-surface-muted"
                  aria-hidden
                >
                  <div
                    className="h-full rounded-[var(--radius-pill)] bg-bg-rail"
                    style={{ width: `${percent}%` }}
                  />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </BentoCard>
  );
}
