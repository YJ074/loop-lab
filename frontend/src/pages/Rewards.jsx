import { useQuery } from "@tanstack/react-query";
import { api, fmtMoney, API } from "@/lib/api";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Download, Coins } from "lucide-react";

export default function Rewards() {
  const { data, isLoading } = useQuery({
    queryKey: ["all-rewards"],
    queryFn: async () => (await api.get("/rewards")).data,
  });

  const exportCsv = () => {
    window.open(`${API}/rewards/export`, "_blank");
  };

  if (isLoading || !data) return <p className="text-slate-500">Loading ledger…</p>;
  const totals = data.totals || {};
  const currencies = Object.keys(totals);

  return (
    <div className="space-y-6" data-testid="rewards-page">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold text-slate-900">Reward Ledger</h1>
          <p className="text-slate-500 mt-1">Liability tracking only — no payouts are executed in v1.</p>
        </div>
        <Button variant="outline" onClick={exportCsv} data-testid="export-rewards-button">
          <Download className="h-4 w-4 mr-1" /> Export CSV
        </Button>
      </div>

      {/* Multi-currency totals */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {currencies.length === 0 && <p className="text-slate-400">No rewards recorded yet.</p>}
        {currencies.map((cur) => (
          <div key={cur} className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm" data-testid={`liability-${cur}`}>
            <div className="flex items-center justify-between mb-4">
              <span className="font-display text-lg font-semibold text-slate-900">{cur} liability</span>
              <div className="h-8 w-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center"><Coins className="h-4 w-4" /></div>
            </div>
            <div className="space-y-3">
              <Row label="Approved (owed)" value={fmtMoney(totals[cur].approved, cur)} dot="bg-emerald-500" />
              <Row label="Pending" value={fmtMoney(totals[cur].pending, cur)} dot="bg-amber-500" />
              <Row label="Reversed" value={fmtMoney(totals[cur].reversed, cur)} dot="bg-slate-400" />
            </div>
          </div>
        ))}
      </div>

      {/* Full ledger */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        <table className="w-full text-sm" data-testid="rewards-ledger-table">
          <thead><tr className="text-left text-slate-400 border-b border-slate-100 bg-slate-50/50">
            <th className="py-3 px-4 font-medium">Advocate</th><th className="py-3 px-4 font-medium">Type</th>
            <th className="py-3 px-4 font-medium">Amount</th><th className="py-3 px-4 font-medium">Currency</th>
            <th className="py-3 px-4 font-medium">Status</th>
          </tr></thead>
          <tbody>
            {(data.rewards || []).map((r) => (
              <tr key={r.id} className="border-b border-slate-50 last:border-0" data-testid={`reward-row-${r.id}`}>
                <td className="py-3 px-4 font-medium text-slate-800">{r.referrer_name}</td>
                <td className="py-3 px-4 text-slate-600 capitalize">{r.type.replace("_", " ")}</td>
                <td className="py-3 px-4 text-slate-600">{r.type === "discount" ? `${r.amount}%` : fmtMoney(r.amount, r.currency)}</td>
                <td className="py-3 px-4 text-slate-600">{r.currency}</td>
                <td className="py-3 px-4"><StatusBadge status={r.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Row({ label, value, dot }) {
  return (
    <div className="flex items-center justify-between">
      <span className="flex items-center gap-2 text-sm text-slate-500"><span className={`h-2 w-2 rounded-full ${dot}`} />{label}</span>
      <span className="font-semibold text-slate-800">{value}</span>
    </div>
  );
}
