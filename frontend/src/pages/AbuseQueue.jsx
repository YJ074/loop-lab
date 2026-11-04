import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, fmtMoney } from "@/lib/api";
import { ConfidenceBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { ShieldAlert, UserX, Smartphone, Ticket } from "lucide-react";

const FLAG_META = {
  self_referral: { label: "Self-referral", icon: UserX, desc: "Advocate's own email used to convert" },
  device_reuse: { label: "Device reuse", icon: Smartphone, desc: "Same device fingerprint seen before" },
  coupon_leakage: { label: "Coupon leakage", icon: Ticket, desc: "Coupon-site code detected" },
};

export default function AbuseQueue() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["abuse"], queryFn: async () => (await api.get("/abuse")).data });

  const reviewMut = useMutation({
    mutationFn: async ({ convId, action }) => (await api.post(`/conversions/${convId}/review?action=${action}`)).data,
    onSuccess: () => {
      toast.success("Reviewed");
      qc.invalidateQueries({ queryKey: ["abuse"] });
      qc.invalidateQueries({ queryKey: ["analytics"] });
    },
  });

  if (isLoading || !data) return <p className="text-slate-500">Loading review queue…</p>;
  const counts = data.counts || {};

  return (
    <div className="space-y-6" data-testid="abuse-page">
      <div>
        <h1 className="font-display text-3xl font-bold text-slate-900">Abuse Review Queue</h1>
        <p className="text-slate-500 mt-1">Suspicious conversions held for manual review before rewards are approved.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {Object.entries(FLAG_META).map(([key, m]) => (
          <div key={key} className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm" data-testid={`flag-count-${key}`}>
            <div className="flex items-center justify-between">
              <div className="h-9 w-9 rounded-lg bg-red-50 text-red-600 flex items-center justify-center"><m.icon className="h-4 w-4" /></div>
              <span className="font-display text-2xl font-bold text-slate-900">{counts[key] || 0}</span>
            </div>
            <p className="mt-3 font-medium text-slate-800">{m.label}</p>
            <p className="text-xs text-slate-400">{m.desc}</p>
          </div>
        ))}
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        <table className="w-full text-sm" data-testid="abuse-table">
          <thead><tr className="text-left text-slate-400 border-b border-slate-100 bg-slate-50/50">
            <th className="py-3 px-4 font-medium">Advocate</th><th className="py-3 px-4 font-medium">Customer</th>
            <th className="py-3 px-4 font-medium">Order</th><th className="py-3 px-4 font-medium">Flags</th>
            <th className="py-3 px-4 font-medium">Confidence</th><th className="py-3 px-4 font-medium">Decision</th>
          </tr></thead>
          <tbody>
            {data.items.length === 0 && (
              <tr><td colSpan={6} className="py-12 text-center text-slate-400">
                <ShieldAlert className="h-8 w-8 mx-auto mb-2 text-emerald-400" />
                All clear — no suspicious conversions.
              </td></tr>
            )}
            {data.items.map((c) => (
              <tr key={c.id} className="border-b border-slate-50 last:border-0" data-testid={`abuse-row-${c.id}`}>
                <td className="py-3 px-4 font-medium text-slate-800">{c.referrer_name}</td>
                <td className="py-3 px-4 text-slate-500 text-xs">{c.customer_email}</td>
                <td className="py-3 px-4 text-slate-600">{fmtMoney(c.order_value, c.currency)}</td>
                <td className="py-3 px-4">{c.flags.map((f) => <span key={f} className="inline-block text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-0.5 mr-1 mb-1 capitalize">{(FLAG_META[f]?.label || f)}</span>)}</td>
                <td className="py-3 px-4"><ConfidenceBadge label={c.confidence_label} value={c.confidence} /></td>
                <td className="py-3 px-4 whitespace-nowrap">
                  <Button size="sm" variant="outline" className="h-7 text-xs mr-1 text-emerald-700 border-emerald-200 hover:bg-emerald-50" onClick={() => reviewMut.mutate({ convId: c.id, action: "approve" })} data-testid={`abuse-approve-${c.id}`}>Approve anyway</Button>
                  <Button size="sm" variant="outline" className="h-7 text-xs text-red-700 border-red-200 hover:bg-red-50" onClick={() => reviewMut.mutate({ convId: c.id, action: "reject" })} data-testid={`abuse-reject-${c.id}`}>Reject</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
