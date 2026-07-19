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
    <div className="mt-4 border-t border-slate-800/80 pt-3">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between text-xs font-semibold text-[#0ea5e9] hover:text-[#0ea5e9]/80 py-1 transition-colors cursor-pointer"
      >
        <span className="flex items-center gap-1.5">
          <span>🧮</span>
          <span>{isOpen ? "Hide Value Calculator" : "Calculate My Value"}</span>
        </span>
        <span>{isOpen ? "▲" : "▼"}</span>
      </button>

      {isOpen && (
        <div className="mt-3 bg-[#0b0f19] border border-slate-800/80 rounded-xl p-4 space-y-4 text-xs">
          {/* Inputs */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">
                Deposit Amount (€)
              </label>
              <input
                type="number"
                min="1"
                value={depositAmount}
                onChange={(e) => setDepositAmount(Math.max(1, Number(e.target.value)))}
                className="w-full bg-[#161e2e] border border-slate-700/80 rounded-lg px-3 py-1.5 text-slate-200 text-xs focus:outline-none focus:border-[#0ea5e9] focus:ring-1 focus:ring-[#0ea5e9]"
              />
            </div>

            {slots.length > 0 && (
              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">
                  Game / Slot (Optional)
                </label>
                <select
                  value={selectedSlotId}
                  onChange={(e) => setSelectedSlotId(e.target.value)}
                  className="w-full bg-[#161e2e] border border-slate-700/80 rounded-lg px-3 py-1.5 text-slate-200 text-xs focus:outline-none focus:border-[#0ea5e9] focus:ring-1 focus:ring-[#0ea5e9]"
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
            <div className="space-y-3 pt-1">
              {result.isCalculable === false ? (
                <div className="bg-[#161e2e] p-4 rounded-xl border border-[#f59e0b]/30 text-center mt-3">
                  <p className="text-[#f59e0b] text-xs font-semibold mb-1">Cannot Calculate Expected Value</p>
                  <p className="text-slate-400 text-[10px]">
                    The bonus headline format is not currently supported by our automatic EV calculator.
                  </p>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-3 border-t border-slate-800/60">
                    {/* Total Wagering Required */}
                    <div className="bg-[#161e2e] p-2.5 rounded-lg border border-slate-800/80 text-center">
                      <span className="text-[9px] uppercase tracking-wider text-slate-400 block mb-0.5">
                        Wagering Required
                      </span>
                      <span className="text-sm font-extrabold font-mono text-white">
                        €{result.totalWageringRequired.toLocaleString()}
                      </span>
                    </div>

                    {/* Estimated EV */}
                    <div className="bg-[#161e2e] p-2.5 rounded-lg border border-slate-800/80 text-center">
                      <span className="text-[9px] uppercase tracking-wider text-slate-400 block mb-0.5">
                        Estimated EV
                      </span>
                      <span
                        className="text-sm font-extrabold font-mono"
                        style={{
                          color: result.expectedValue >= 0 ? "#10b981" : "#ef4444",
                        }}
                      >
                        {result.expectedValue >= 0 ? "+" : ""}€{result.expectedValue.toFixed(2)}
                      </span>
                    </div>

                    {/* Capped Payout */}
                    <div className="bg-[#161e2e] p-2.5 rounded-lg border border-slate-800/80 text-center">
                      <span className="text-[9px] uppercase tracking-wider text-slate-400 block mb-0.5">
                        Capped Payout
                      </span>
                      <span className="text-sm font-extrabold font-mono text-slate-200">
                        €{result.cappedPayout.toFixed(2)}
                        {result.isCapped && (
                          <span className="text-[9px] text-[#f59e0b] block font-sans font-normal">
                            Capped
                          </span>
                        )}
                      </span>
                    </div>

                    {/* Days Left */}
                    <div className="bg-[#161e2e] p-2.5 rounded-lg border border-slate-800/80 text-center">
                      <span className="text-[9px] uppercase tracking-wider text-slate-400 block mb-0.5">
                        Days Left
                      </span>
                      {result.daysUntilExpiry !== null ? (
                        <div className="flex flex-col items-center">
                          <span className="text-sm font-extrabold font-mono text-slate-200">
                            {result.daysUntilExpiry} days
                          </span>
                          {result.daysUntilExpiry < 7 && (
                            <span className="bg-[#f59e0b]/20 text-[#f59e0b] border border-[#f59e0b]/40 text-[8px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider mt-0.5">
                              Expiring soon
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs font-mono text-slate-400">Ongoing</span>
                      )}
                    </div>
                  </div>

                  {/* Disclaimer */}
                  <p className="text-[10px] text-slate-400 italic text-center leading-normal">
                    {result.houseEdgeSource === "slot_rtp" && selectedSlot ? (
                      <>
                        Based on <strong className="text-slate-300 not-italic">{selectedSlot.name}</strong>'s actual RTP ({selectedSlot.rtp_current ?? (100 - result.houseEdgeUsed * 100).toFixed(1)}%)
                      </>
                    ) : (
                      <>
                        Based on average slot house edge ({(result.houseEdgeUsed * 100).toFixed(0)}%) — select a specific game for a more accurate estimate.
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
