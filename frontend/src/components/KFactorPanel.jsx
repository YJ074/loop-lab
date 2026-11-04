import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Info, ChevronDown, Timer, Repeat } from "lucide-react";

export const useKFactor = (campaignId) =>
  useQuery({
    queryKey: ["kfactor", campaignId],
    queryFn: async () => (await api.get(`/campaigns/${campaignId}/kfactor`)).data,
    enabled: !!campaignId,
    refetchInterval: 5000,
  });

export const fmtCycle = (h) => {
  if (h === null || h === undefined) return "not enough data";
  if (h < 24) return `${h.toFixed(1)} hours`;
  return `${(h / 24).toFixed(1)} days`;
};

const interpret = (k) => {
  if (k > 1) return "Above 1: the loop grows by itself, if people stay.";
  if (k === 1) return "Equal to 1: each customer replaces themselves. The loop holds steady.";
  return "Below 1: the loop is not paying for itself on its own.";
};

const pct = (v) => `${(v * 100).toFixed(1)}%`;

function Part({ label, value, testId, hint }) {
  return (
    <div className="min-w-0" data-testid={testId}>
      <p className="text-[11px] uppercase tracking-wider text-slate-400">{label}</p>
      <p className="font-display text-lg font-semibold text-slate-800 tabular-nums">{value}</p>
      <p className="text-[11px] text-slate-400 truncate">{hint}</p>
    </div>
  );
}

export function HowKWorks() {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-t border-slate-100 pt-3">
      <button onClick={() => setOpen(!open)} data-testid="how-k-works-toggle"
        className="flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-800">
        <Info className="h-3.5 w-3.5" /> How K works
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="mt-2 text-xs text-slate-500 space-y-1.5 leading-relaxed" data-testid="how-k-works-note">
          <p>K = verified conversions ÷ customers (advocates who joined this campaign). Each campaign has its own K, and campaigns are never mixed.</p>
          <p>Loop Lab measures shares and clicks itself. Conversions are reported by your brand through Shopify, the webhook or a CSV import.</p>
          <p>The idea comes from Alex Schultz's Y Combinator growth lecture: virality is payload × frequency × conversion. K above 1 only matters if people stay.</p>
        </div>
      )}
    </div>
  );
}

export function KFactorPanel({ campaignId }) {
  const { data: k, isLoading } = useKFactor(campaignId);
  if (!campaignId) return null;
  if (isLoading || !k) return <div className="bg-white border border-slate-200 rounded-xl p-6 text-slate-400" data-testid="kfactor-loading">Loading K-factor…</div>;
  const K = Math.round(k.k * 100) / 100;
  const good = K >= 1;
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 shadow-sm space-y-4" data-testid="kfactor-panel">
      <div className="flex flex-col sm:flex-row sm:items-end gap-4 sm:gap-10">
        <div>
          <p className="text-xs uppercase tracking-wider text-slate-400 flex items-center gap-1.5"><Repeat className="h-3.5 w-3.5" /> K-factor · {k.campaign_name}</p>
          <p className={`font-display text-6xl font-bold tabular-nums ${good ? "text-emerald-600" : "text-slate-900"}`} data-testid="kfactor-value">{K.toFixed(2)}</p>
        </div>
        <div className="pb-2">
          <p className="text-xs uppercase tracking-wider text-slate-400 flex items-center gap-1.5"><Timer className="h-3.5 w-3.5" /> Cycle time</p>
          <p className="font-display text-2xl font-semibold text-slate-800" data-testid="kfactor-cycle-time">{fmtCycle(k.cycle_time_hours)}</p>
        </div>
      </div>
      <p className={`text-sm font-medium ${good ? "text-emerald-700" : "text-amber-700"}`} data-testid="kfactor-interpretation">{interpret(K)}</p>
      <div className="grid grid-cols-3 gap-3 sm:gap-6 bg-slate-50 rounded-lg p-3">
        <Part testId="kfactor-shares-per-customer" label="Shares / customer" value={k.shares_per_customer.toFixed(2)} hint={`${k.shares} shares ÷ ${k.customers}`} />
        <Part testId="kfactor-click-rate" label="× Click rate" value={pct(k.click_rate)} hint={`${k.clicks} clicks ÷ ${k.shares}`} />
        <Part testId="kfactor-conversion-rate" label="× Conv. rate" value={pct(k.conversion_rate)} hint={`${k.conversions} verified ÷ ${k.clicks}`} />
      </div>
      {k.small_sample && (
        <p className="text-xs text-slate-500 italic" data-testid="kfactor-small-sample">Small sample. Treat K as a first reading, not a result. ({k.customers} customers)</p>
      )}
      <HowKWorks />
    </div>
  );
}
