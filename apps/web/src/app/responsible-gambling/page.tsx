import Link from "next/link";

export const metadata = {
  title: "Responsible Gambling Resources | SavvyEdge",
  description:
    "Information and support resources for safe, responsible gambling. Learn warning signs, self-exclusion tools, and helpline contacts.",
};

export default function ResponsibleGamblingPage() {
  return (
    <div className="max-w-4xl mx-auto space-y-8">
      {/* Back Link */}
      <div>
        <Link
          href="/"
          className="text-xs font-semibold text-[#0ea5e9] hover:underline flex items-center gap-1"
        >
          ← Back to home
        </Link>
      </div>

      {/* Prominent Amber Disclaimer Banner */}
      <div className="bg-amber-500/15 border border-amber-500/40 rounded-2xl p-4 sm:p-5 flex items-center gap-4 text-amber-200">
        <span className="text-2xl shrink-0">⚠️</span>
        <div className="text-xs sm:text-sm font-semibold leading-relaxed">
          If you or someone you know has a gambling problem, please seek help immediately. Gambling should never be viewed as a financial solution.
        </div>
      </div>

      {/* Page Header */}
      <div className="border-b border-slate-800/80 pb-6 space-y-3">
        <h1 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
          Responsible Gambling
        </h1>
        <p className="text-slate-400 text-sm leading-relaxed">
          SavvyEdge promotes safe and responsible gaming. We provide resources to help maintain control over your gambling activity.
        </p>
      </div>

      <div className="space-y-6 text-slate-300 text-sm leading-relaxed">
        {/* Section 1: Gambling Should Be Entertainment */}
        <section className="bg-[#161e2e] border border-slate-800/80 rounded-2xl p-6 space-y-3">
          <h2 className="text-lg font-bold text-white">
            1. Gambling Should Be Entertainment
          </h2>
          <p>
            Online gambling is designed exclusively for recreation and entertainment.
            Never view gambling as a way to make money, pay off debt, or escape daily
            stresses. Set strict budget limits and session times before placing any bets.
          </p>
        </section>

        {/* Section 2: Warning Signs */}
        <section className="bg-[#161e2e] border border-slate-800/80 rounded-2xl p-6 space-y-4">
          <h2 className="text-lg font-bold text-white">
            2. Warning Signs of Problem Gambling
          </h2>
          <p className="text-slate-400 text-xs">
            Recognizing early warning signs is essential. Be aware if you or a loved one exhibit any of the following:
          </p>
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
            <li className="bg-[#0b0f19] p-3.5 rounded-xl border border-slate-800 text-xs text-slate-300 flex items-start gap-2">
              <span className="text-amber-400 font-bold">•</span>
              <span>Spending more money or time gambling than intended.</span>
            </li>
            <li className="bg-[#0b0f19] p-3.5 rounded-xl border border-slate-800 text-xs text-slate-300 flex items-start gap-2">
              <span className="text-amber-400 font-bold">•</span>
              <span>Chasing losses to try and win back money lost.</span>
            </li>
            <li className="bg-[#0b0f19] p-3.5 rounded-xl border border-slate-800 text-xs text-slate-300 flex items-start gap-2">
              <span className="text-amber-400 font-bold">•</span>
              <span>Borrowing money or selling assets to fund gambling bets.</span>
            </li>
            <li className="bg-[#0b0f19] p-3.5 rounded-xl border border-slate-800 text-xs text-slate-300 flex items-start gap-2">
              <span className="text-amber-400 font-bold">•</span>
              <span>Neglecting personal, family, or work responsibilities.</span>
            </li>
            <li className="bg-[#0b0f19] p-3.5 rounded-xl border border-slate-800 text-xs text-slate-300 flex items-start gap-2">
              <span className="text-amber-400 font-bold">•</span>
              <span>Lying to friends or family about gambling habits.</span>
            </li>
            <li className="bg-[#0b0f19] p-3.5 rounded-xl border border-slate-800 text-xs text-slate-300 flex items-start gap-2">
              <span className="text-amber-400 font-bold">•</span>
              <span>Feeling anxious, irritable, or depressed about gambling.</span>
            </li>
          </ul>
        </section>

        {/* Section 3: Self-Exclusion Tools */}
        <section className="bg-[#161e2e] border border-slate-800/80 rounded-2xl p-6 space-y-4">
          <h2 className="text-lg font-bold text-white">
            3. Self-Exclusion &amp; Protection Tools
          </h2>
          <p>
            If you feel your gambling is becoming uncontrollable, utilize self-exclusion software and national registries:
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
            <div className="bg-[#0b0f19] p-4 rounded-xl border border-slate-800 space-y-1">
              <span className="font-bold text-white block">GamStop (UK)</span>
              <p className="text-slate-400">
                Free self-exclusion service for all UKGC-licensed online operators.
              </p>
            </div>
            <div className="bg-[#0b0f19] p-4 rounded-xl border border-slate-800 space-y-1">
              <span className="font-bold text-white block">GAMBAN</span>
              <p className="text-slate-400">
                Software blocking access to thousands of gambling websites across devices.
              </p>
            </div>
            <div className="bg-[#0b0f19] p-4 rounded-xl border border-slate-800 space-y-1">
              <span className="font-bold text-white block">State Registries</span>
              <p className="text-slate-400">
                National and state self-exclusion lists in US/EU jurisdictions.
              </p>
            </div>
          </div>
        </section>

        {/* Section 4: Get Help Now */}
        <section className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-6 space-y-4 text-amber-200">
          <h2 className="text-xl font-bold text-amber-300 flex items-center gap-2">
            <span>🆘</span> 4. Get Help Now
          </h2>
          <p className="text-xs sm:text-sm text-slate-300">
            Free, confidential support is available 24/7 through independent help organizations:
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-1">
            <a
              href="https://www.begambleaware.org"
              target="_blank"
              rel="noopener noreferrer"
              className="bg-[#0b0f19] p-4 rounded-xl border border-amber-500/30 hover:border-amber-400 transition-colors block"
            >
              <span className="font-bold text-white text-xs block">BeGambleAware</span>
              <span className="text-[#0ea5e9] text-xs font-mono">begambleaware.org</span>
            </a>

            <a
              href="https://www.gamblersanonymous.org"
              target="_blank"
              rel="noopener noreferrer"
              className="bg-[#0b0f19] p-4 rounded-xl border border-amber-500/30 hover:border-amber-400 transition-colors block"
            >
              <span className="font-bold text-white text-xs block">Gamblers Anonymous</span>
              <span className="text-[#0ea5e9] text-xs font-mono">gamblersanonymous.org</span>
            </a>

            <div className="bg-[#0b0f19] p-4 rounded-xl border border-amber-500/30">
              <span className="font-bold text-white text-xs block">National Helpline</span>
              <span className="text-amber-400 font-bold font-mono text-sm block">1-800-522-4700</span>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
