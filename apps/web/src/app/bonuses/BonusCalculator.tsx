"use client";

import { useState, useEffect } from "react";

interface SlotItem {
  id: string;
  name: string;
  provider_name: string;
  rtp_current?: number | null;
  wagering_contribution_pct?: number;
}

interface CalculationResult {
  bonusAmount: number;
  totalWageringRequired: number;
  expectedValue: number;
  cappedPayout: number;
  daysUntilExpiry: number | null;
  isCapped: boolean;
  houseEdgeUsed: number;
  houseEdgeSource: "slot_rtp" | "default_assumption";
  isCalculable: boolean;
}

interface BonusCalculatorProps {
  bonusId: string;
  headlineValue: string | null;
  wageringRequirement: number | null;
  maxConversion: number | null;
  validUntil: Date | string | null;
}

export default function BonusCalculator({
  bonusId,
}: BonusCalculatorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [depositAmount, setDepositAmount] = useState<number>(100);
  const [selectedSlotId, setSelectedSlotId] = useState<string>("");
  const [slots, setSlots] = useState<SlotItem[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [result, setResult] = useState<CalculationResult | null>(null);

  useEffect(() => {
    if (isOpen && slots.length === 0 && !loadingSlots) {
      setLoadingSlots(true);
      fetch("/api/slots")
        .then((res) => res.json())
        .then((data) => {
          if (Array.isArray(data)) {
            setSlots(data);
          }
        })
        .catch((err) => console.error("Error fetching slots:", err))
        .finally(() => setLoadingSlots(false));
    }
  }, [isOpen, slots.length, loadingSlots]);

  useEffect(() => {
    if (!isOpen) return;

    fetch(`/api/v1/bonuses/${bonusId}/calculate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        depositAmount: Number(depositAmount) || 0,
        slotId: selectedSlotId || undefined,
      }),
    })
      .then((res) => res.json())
      .then((resData) => {
        if (resData.data) {
          setResult(resData.data);
        }
      })
      .catch((err) => console.error("Error calculating EV:", err));
  }, [isOpen, bonusId, depositAmount, selectedSlotId]);

  const selectedSlot = slots.find((s) => s.id === selectedSlotId);

  return (
    <div className="mt-3 pt-2 border-t border-white/[0.06]">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between text-[11px] font-medium text-zinc-400 hover:text-emerald-400 py-1.5 px-3 rounded-lg bg-zinc-900/50 border border-white/[0.08] backdrop-blur-sm transition-all cursor-pointer"
      >
        <span className="flex items-center gap-2">
          <span className="text-zinc-500">🧮</span>
          <span className="tracking-wide text-zinc-300">
            {isOpen ? "Hide EV Calculator" : "Calculate Value (EV)"}
          </span>
        </span>
        <span className="text-[10px] text-zinc-500">{isOpen ? "▲" : "▼"}</span>
      </button>

      {isOpen && (
        <div className="mt-2 bg-[#090d14]/90 border border-white/[0.08] rounded-xl p-3 space-y-2.5 backdrop-blur-md shadow-xl shadow-black/50">
          {/* Inputs */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <label className="block text-[10px] font-medium uppercase tracking-wider text-zinc-400 mb-1">
                Deposit Amount (€)
              </label>
              <input
                type="number"
                min="1"
                value={depositAmount}
                onChange={(e) => setDepositAmount(Math.max(1, Number(e.target.value)))}
                className="w-full bg-zinc-900/70 border border-white/[0.08] focus:border-[#10b981]/50 focus:ring-1 focus:ring-[#10b981]/30 rounded-lg px-2.5 py-1 text-xs font-mono tabular-nums text-zinc-200 focus:outline-none backdrop-blur-sm transition-all"
              />
            </div>

            {slots.length > 0 && (
              <div>
                <label className="block text-[10px] font-medium uppercase tracking-wider text-zinc-400 mb-1">
                  Game / Slot (Optional)
                </label>
                <select
                  value={selectedSlotId}
                  onChange={(e) => setSelectedSlotId(e.target.value)}
                  className="w-full bg-zinc-900/70 border border-white/[0.08] focus:border-[#10b981]/50 focus:ring-1 focus:ring-[#10b981]/30 rounded-lg px-2.5 py-1 text-xs text-zinc-200 focus:outline-none backdrop-blur-sm transition-all"
                >
                  <option value="">Default Slots (100% contribution)</option>
                  {slots.map((slot) => (
                    <option key={slot.id} value={slot.id}>
                      {slot.name} ({slot.provider_name}) - {slot.wagering_contribution_pct ?? 100}%
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Results Output */}
          {result && (
            <div className="space-y-2 pt-0.5">
              {result.isCalculable === false ? (
                <div className="bg-amber-500/10 p-2.5 rounded-lg border border-amber-500/20 text-center">
                  <p className="text-amber-400 text-[11px] font-medium mb-0.5">
                    Expected Value Not Calculable
                  </p>
                  <p className="text-zinc-400 text-[10px]">
                    This headline format contains ambiguous terms or non-standard structures.
                  </p>
                </div>
              ) : (
                <>
                  {/* Main Result Panel */}
                  <div
                    className="bg-zinc-900/80 border rounded-lg p-2.5 flex items-center justify-between backdrop-blur-md transition-all"
                    style={{
                      borderColor: result.expectedValue >= 0 ? "rgba(16, 185, 129, 0.25)" : "rgba(239, 68, 68, 0.25)",
                    }}
                  >
                    <div>
                      <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-400 block">
                        Estimated Expected Value (EV)
                      </span>
                      <span className="text-[10px] text-zinc-500 block">
                        Net value after turnover &amp; house edge
                      </span>
                    </div>
                    <div className="text-right">
                      <span
                        className="text-xl sm:text-2xl font-bold font-mono tabular-nums block"
                        style={{
                          color: result.expectedValue >= 0 ? "#10b981" : "#f87171",
                        }}
                      >
                        {result.expectedValue >= 0 ? "+" : ""}€{result.expectedValue.toFixed(2)}
                      </span>
                    </div>
                  </div>

                  {/* Supporting Metrics Grid */}
                  <div className="grid grid-cols-3 gap-1.5 pt-1.5 border-t border-white/[0.06]">
                    {/* Total Wagering Required */}
                    <div className="bg-zinc-900/40 p-2 rounded-lg border border-white/[0.06] text-center">
                      <span className="text-[10px] font-medium text-zinc-400 block mb-0.5">
                        Turnover Req.
                      </span>
                      <span className="text-xs sm:text-[13px] font-semibold font-mono tabular-nums text-zinc-200">
                        €{result.totalWageringRequired.toLocaleString()}
                      </span>
                    </div>

                    {/* Capped Payout */}
                    <div className="bg-zinc-900/40 p-2 rounded-lg border border-white/[0.06] text-center">
                      <span className="text-[10px] font-medium text-zinc-400 block mb-0.5">
                        Max Payout
                      </span>
                      <span className="text-xs sm:text-[13px] font-semibold font-mono tabular-nums text-zinc-200">
                        €{result.cappedPayout.toFixed(2)}
                        {result.isCapped && (
                          <span className="text-[9px] text-amber-400 block font-sans font-medium">
                            Capped
                          </span>
                        )}
                      </span>
                    </div>

                    {/* Days Left */}
                    <div className="bg-zinc-900/40 p-2 rounded-lg border border-white/[0.06] text-center">
                      <span className="text-[10px] font-medium text-zinc-400 block mb-0.5">
                        Validity
                      </span>
                      {result.daysUntilExpiry !== null ? (
                        <span className="text-xs sm:text-[13px] font-semibold font-mono tabular-nums text-zinc-200 block">
                          {result.daysUntilExpiry}d
                        </span>
                      ) : (
                        <span className="text-xs sm:text-[13px] font-mono text-zinc-400 block">Ongoing</span>
                      )}
                    </div>
                  </div>

                  {/* Disclaimer / Footnote */}
                  <p className="text-[10px] text-zinc-500 font-mono text-center pt-1 border-t border-white/[0.04]">
                    {result.houseEdgeSource === "slot_rtp" && selectedSlot ? (
                      <>
                        RTP: <span className="text-zinc-300">{selectedSlot.name}</span> ({selectedSlot.rtp_current ?? (100 - result.houseEdgeUsed * 100).toFixed(1)}%)
                      </>
                    ) : (
                      <>
                        Slot House Edge: {(result.houseEdgeUsed * 100).toFixed(0)}% (Baseline)
                      </>
                    )}
                  </p>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
