"use client";

import { useEffect, useState } from "react";
import { BentoCard, PillButton } from "@/components/bento";

type GroupHeaderProps = {
  name: string;
  inviteCode: string;
  onCopyInvite: () => void;
};

export default function GroupHeader({
  name,
  inviteCode,
  onCopyInvite,
}: GroupHeaderProps) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;

    const timer = setTimeout(() => {
      setCopied(false);
    }, 2000);

    return () => clearTimeout(timer);
  }, [copied]);

  // Preserve the existing copy-invite behavior (Req 13.7): delegate to the
  // handler, then surface the transient "copied" confirmation.
  function handleCopy() {
    onCopyInvite();
    setCopied(true);
  }

  return (
    <BentoCard as="section" className="flex flex-col gap-5">
      {/* Club name in the editorial serif (steering §3). */}
      <h1 className="font-serif text-4xl font-semibold leading-tight text-text-primary">
        {name}
      </h1>

      <div className="flex flex-col gap-3">
        <p className="font-sans text-xs font-semibold uppercase tracking-widest text-text-secondary">
          Invite Code
        </p>

        {/* Inner sub-card holding the code + copy control (steering §4). */}
        <BentoCard
          tone="inner"
          padding="compact"
          className="flex items-center justify-between gap-4 bg-bg-surface-muted"
        >
          <span
            data-numeric
            className="font-mono text-2xl font-bold tracking-[0.25em] tabular-nums text-text-primary sm:text-3xl"
          >
            {inviteCode}
          </span>

          <PillButton
            variant={copied ? "soft" : "solid"}
            onClick={handleCopy}
          >
            {copied ? "✓ Copied" : "Copy"}
          </PillButton>
        </BentoCard>

        <p className="font-sans text-sm text-text-secondary">
          Share this code with anyone you&apos;d like to invite to this group.
        </p>
      </div>
    </BentoCard>
  );
}
