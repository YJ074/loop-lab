import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, fmtMoney } from "@/lib/api";
import { StatusBadge, ConfidenceBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

const FILTERS = ["all", "pending", "verified", "flagged", "reversed"];

export default function Conversions() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState("all");

  const { data: conversions = [], isLoading } = useQuery({
    queryKey: ["all-conversions", filter],
    queryFn: async () => (await api.get(`/conversions${filter === "all" ? "" : `?status=${filter}`}`)).data,
  });

  const reviewMut = useMutation({
    mutationFn: async ({ convId, action }) => (await api.post(`/conversions/${convId}/review?action=${action}`)).data,
    onSuccess: () => {
      toast.success("Conversion updated");
      qc.invalidateQueries({ queryKey: ["all-conversions"] });
      qc.invalidateQueries({ queryKey: ["analytics"] });
    },
  });

  return (
    <div className="space-y-6" data-testid="conversions-page">
      <div>
        <h1 className="font-display text-3xl font-bold text-slate-900">Conversions</h1>
        <p className="text-slate-500 mt-1">Every matched conversion with its attribution confidence.</p>
      </div>

      <div className="flex gap-2 flex-wrap">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            data-testid={`filter-${f}`}
            className={`px-3 py-1.5 rounded-full text-sm font-medium capitalize transition-colors ${
              filter === f ? "bg-slate-900 text-white" : "bg-white border border-slate-200 text-slate-600 hover:border-slate-300"
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        <table className="w-full text-sm" data-testid="all-conversions-table">
          <thead><tr className="text-left text-slate-400 border-b border-slate-100 bg-slate-50/50">
            <th className="py-3 px-4 font-medium">Advocate</th><th className="py-3 px-4 font-medium">Customer</th>
            <th className="py-3 px-4 font-medium">Order</th><th className="py-3 px-4 font-medium">Source</th>
            <th className="py-3 px-4 font-medium">Confidence</th><th className="py-3 px-4 font-medium">Flags</th>
            <th className="py-3 px-4 font-medium">Status</th><th className="py-3 px-4 font-medium">Actions</th>
          </tr></thead>
          <tbody>
            {isLoading && <tr><td colSpan={8} className="py-10 text-center text-slate-400">Loading…</td></tr>}
            {!isLoading && conversions.length === 0 && <tr><td colSpan={8} className="py-10 text-center text-slate-400">No conversions found.</td></tr>}
            {conversions.map((c) => (
              <tr key={c.id} className="border-b border-slate-50 last:border-0" data-testid={`conv-row-${c.id}`}>
                <td className="py-3 px-4 font-medium text-slate-800">{c.referrer_name}</td>
                <td className="py-3 px-4 text-slate-500 text-xs">{c.customer_email}</td>
                <td className="py-3 px-4 text-slate-600">{fmtMoney(c.order_value, c.currency)}</td>
                <td className="py-3 px-4"><span className="text-xs capitalize bg-slate-100 px-2 py-0.5 rounded">{c.source}</span></td>
                <td className="py-3 px-4"><ConfidenceBadge label={c.confidence_label} value={c.confidence} /></td>
                <td className="py-3 px-4">{c.flags?.length ? c.flags.map((f) => <span key={f} className="text-xs text-red-600 block capitalize">{f.replace(/_/g, " ")}</span>) : <span className="text-slate-300">—</span>}</td>
                <td className="py-3 px-4"><StatusBadge status={c.status} /></td>
                <td className="py-3 px-4 whitespace-nowrap">
                  {c.status !== "verified" && c.status !== "reversed" && (
                    <Button size="sm" variant="outline" className="h-7 text-xs mr-1" onClick={() => reviewMut.mutate({ convId: c.id, action: "approve" })} data-testid={`conv-approve-${c.id}`}>Approve</Button>
                  )}
                  {c.status === "verified" && (
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => reviewMut.mutate({ convId: c.id, action: "reverse" })} data-testid={`conv-reverse-${c.id}`}>Reverse</Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
