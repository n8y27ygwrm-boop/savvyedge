interface VerificationBadgeProps {
  eligible: boolean;
  compact?: boolean;
}

export default function VerificationBadge({
  eligible,
  compact = false,
}: VerificationBadgeProps) {
  const sizing = compact
    ? "text-[9px] px-1.5 py-0.5"
    : "text-xs px-3 py-1";

  if (eligible) {
    return (
      <span
        className={`bg-[#10b981]/15 text-[#10b981] border border-[#10b981]/30 font-semibold ${sizing} rounded-full tracking-wider uppercase inline-flex items-center gap-1`}
      >
        <span aria-hidden="true">✓</span> Verified
      </span>
    );
  }

  return (
    <span
      className={`bg-zinc-800 text-zinc-400 border border-zinc-700/60 font-medium ${sizing} rounded-full tracking-wider uppercase inline-flex items-center`}
    >
      Verification pending
    </span>
  );
}
