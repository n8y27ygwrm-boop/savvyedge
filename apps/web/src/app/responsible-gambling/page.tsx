import Link from "next/link";

export const metadata = {
  title: "Responsible Gambling Resources | SavvyEdge",
  description: "Guidelines, self-exclusion tools, and helpline resources for safe gambling practices.",
};

export default function ResponsibleGamblingPage() {
  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="border-b border-slate-800/80 pb-6">
        <h1 className="text-3xl font-extrabold text-white tracking-tight">
          Responsible Gambling
        </h1>
        <p className="text-slate-400 mt-2 text-base">
          Gambling should be a form of entertainment, not a source of income or financial stress.
        </p>
      </div>

      {/* Main Content */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        <div className="md:col-span-2 space-y-6 text-slate-300">
          <section className="bg-[#161e2e] border border-slate-800/80 rounded-2xl p-6 space-y-4">
            <h2 className="text-xl font-bold text-white">Our Commitment to Safety</h2>
            <p className="text-sm leading-relaxed text-slate-300">
              SavvyEdge is dedicated to promoting safe, accountable, and responsible gambling practices. We only index and evaluate operators that hold verified regulatory licenses and adhere to strict player protection guidelines.
            </p>
          </section>

          <section className="bg-[#161e2e] border border-slate-800/80 rounded-2xl p-6 space-y-4">
            <h2 className="text-xl font-bold text-white">Warning Signs of Problem Gambling</h2>
            <ul className="list-disc list-inside space-y-2 text-sm text-slate-300">
              <li>Spending more money or time gambling than originally intended.</li>
              <li>Chasing losses by gambling larger amounts to recover money lost.</li>
              <li>Neglecting personal, family, or professional responsibilities.</li>
              <li>Borrowing money or selling possessions to fund gambling activities.</li>
              <li>Feeling anxious, stressed, or irritable when trying to stop or cut back.</li>
            </ul>
          </section>

          <section className="bg-[#161e2e] border border-slate-800/80 rounded-2xl p-6 space-y-4">
            <h2 className="text-xl font-bold text-white">Player Self-Protection Tools</h2>
            <p className="text-sm leading-relaxed">
              Licensed online casinos provide built-in controls to help you manage your activity:
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
              <div className="p-4 bg-[#0b0f19] rounded-xl border border-slate-800">
                <h3 className="font-semibold text-white text-sm">Deposit & Loss Limits</h3>
                <p className="text-xs text-slate-400 mt-1">Set daily, weekly, or monthly caps on how much money you can deposit or lose.</p>
              </div>
              <div className="p-4 bg-[#0b0f19] rounded-xl border border-slate-800">
                <h3 className="font-semibold text-white text-sm">Timeouts & Cool-Offs</h3>
                <p className="text-xs text-slate-400 mt-1">Take a mandatory break from gambling ranging from 24 hours to several weeks.</p>
              </div>
              <div className="p-4 bg-[#0b0f19] rounded-xl border border-slate-800">
                <h3 className="font-semibold text-white text-sm">Self-Exclusion</h3>
                <p className="text-xs text-slate-400 mt-1">Block access to your account across all regulated operators for 6 months to permanently.</p>
              </div>
              <div className="p-4 bg-[#0b0f19] rounded-xl border border-slate-800">
                <h3 className="font-semibold text-white text-sm">Session Reality Checks</h3>
                <p className="text-xs text-slate-400 mt-1">Pop-up notifications displaying the duration of your current playing session.</p>
              </div>
            </div>
          </section>
        </div>

        {/* Sidebar Helpline Contacts */}
        <div className="space-y-6">
          <div className="bg-gradient-to-br from-amber-500/10 to-amber-700/10 border border-amber-500/30 rounded-2xl p-6 text-amber-200 space-y-4">
            <h3 className="font-bold text-lg text-amber-300">Need Immediate Help?</h3>
            <p className="text-xs leading-relaxed text-amber-200/90">
              Free, confidential support is available 24/7. Reach out to dedicated counseling services:
            </p>
            <div className="space-y-3 pt-2">
              <div className="p-3 bg-[#0b0f19]/60 rounded-xl border border-amber-500/20">
                <div className="text-xs font-bold text-amber-400 uppercase tracking-wider">United States</div>
                <div className="font-mono text-sm font-bold text-white mt-0.5">1-800-GAMBLER</div>
                <a href="https://www.ncpgambling.org" target="_blank" rel="noopener noreferrer" className="text-xs underline text-amber-300 hover:text-white">
                  ncpgambling.org
                </a>
              </div>
              <div className="p-3 bg-[#0b0f19]/60 rounded-xl border border-amber-500/20">
                <div className="text-xs font-bold text-amber-400 uppercase tracking-wider">United Kingdom</div>
                <div className="font-mono text-sm font-bold text-white mt-0.5">0808 8020 133</div>
                <a href="https://www.begambleaware.org" target="_blank" rel="noopener noreferrer" className="text-xs underline text-amber-300 hover:text-white">
                  begambleaware.org
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
