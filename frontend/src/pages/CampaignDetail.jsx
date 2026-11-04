import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, fmtMoney } from "@/lib/api";
import { StatCard } from "@/components/StatCard";
import { StatusBadge, ConfidenceBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  ArrowLeft, Share2, Copy, Play, Upload, MousePointerClick, Target, Coins, UserPlus,
  MessageCircle, Mail, Instagram, Link2, CheckCircle2,
} from "lucide-react";

const CHANNEL_ICON = { whatsapp: MessageCircle, copy_link: Link2, email: Mail, instagram: Instagram };

export default function CampaignDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [refName, setRefName] = useState("");
  const [refEmail, setRefEmail] = useState("");

  const { data: camp } = useQuery({ queryKey: ["campaign", id], queryFn: async () => (await api.get(`/campaigns/${id}`)).data });
  const { data: referrers = [] } = useQuery({ queryKey: ["referrers", id], queryFn: async () => (await api.get(`/campaigns/${id}/referrers`)).data });
  const { data: share } = useQuery({ queryKey: ["share", id], queryFn: async () => (await api.get(`/campaigns/${id}/share`)).data });
  const { data: conversions = [] } = useQuery({ queryKey: ["conversions", id], queryFn: async () => (await api.get(`/conversions?campaign_id=${id}`)).data });
  const { data: rewardsData } = useQuery({ queryKey: ["rewards", id], queryFn: async () => (await api.get(`/rewards?campaign_id=${id}`)).data });

  const refetchAll = () => {
    ["campaign", "referrers", "conversions", "rewards", "share"].forEach((k) => qc.invalidateQueries({ queryKey: [k, id] }));
    qc.invalidateQueries({ queryKey: ["analytics"] });
  };

  const simulateMut = useMutation({
    mutationFn: async () => (await api.post(`/campaigns/${id}/simulate`)).data,
    onSuccess: (c) => { toast.success(`Simulated conversion → ${c.status}`); refetchAll(); },
    onError: (e) => toast.error(e?.response?.data?.detail || "Simulation failed"),
  });

  const addRefMut = useMutation({
    mutationFn: async () => (await api.post(`/campaigns/${id}/referrers`, { name: refName, email: refEmail })).data,
    onSuccess: () => { toast.success("Advocate added with tracked links"); setRefName(""); setRefEmail(""); refetchAll(); },
    onError: () => toast.error("Could not add advocate"),
  });

  const reviewMut = useMutation({
    mutationFn: async ({ convId, action }) => (await api.post(`/conversions/${convId}/review?action=${action}`)).data,
    onSuccess: () => { toast.success("Conversion updated"); refetchAll(); },
  });

  const importCsv = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    try {
      const { data } = await api.post(`/campaigns/${id}/import-csv`, fd, { headers: { "Content-Type": "multipart/form-data" } });
      toast.success(`Imported ${data.imported} conversions`, {
        description: data.skipped?.length ? `Skipped ${data.skipped.length}: ${data.skipped.slice(0, 3).map((s) => `row ${s.row} (${s.reason})`).join(", ")}` : undefined,
      });
      refetchAll();
    } catch {
      toast.error("Import failed");
    }
    e.target.value = "";
  };

  const copyText = (t) => { navigator.clipboard?.writeText(t); toast.success("Copied to clipboard"); };

  if (!camp) return <p className="text-slate-500">Loading campaign…</p>;
  const s = camp.stats;
  const cur = camp.reward_currency;

  return (
    <div className="space-y-6" data-testid="campaign-detail-page">
      <button onClick={() => navigate("/campaigns")} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800" data-testid="back-to-campaigns">
        <ArrowLeft className="h-4 w-4" /> Campaigns
      </button>

      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="font-display text-3xl font-bold text-slate-900">{camp.name}</h1>
            <StatusBadge status={camp.status} />
          </div>
          <p className="text-slate-500 mt-1 capitalize">
            {camp.template.replace(/_/g, " ")} · {camp.conversion_event} event · reward {camp.reward_type === "discount" ? `${camp.reward_value}%` : fmtMoney(camp.reward_value, cur)} · {camp.approval_mode.replace(/_/g, " ")}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => simulateMut.mutate()} disabled={simulateMut.isPending} data-testid="simulate-conversion-button">
            <Play className="h-4 w-4 mr-1" /> Simulate conversion
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard testId="detail-clicks" label="Clicks" value={s.clicks} icon={MousePointerClick} accent="sky" />
        <StatCard testId="detail-conversions" label="Conversions" value={s.conversions} icon={Target} accent="emerald" />
        <StatCard testId="detail-cpa" label="Referral CPA" value={fmtMoney(s.cpa, cur)} sub={`paid ${fmtMoney(s.paid_cpa_benchmark, cur)}`} icon={Coins} accent="indigo" />
        <StatCard testId="detail-liability" label="Approved liability" value={fmtMoney(s.approved_liability, cur)} icon={Coins} accent="amber" />
      </div>

      <Tabs defaultValue="share" className="w-full">
        <TabsList data-testid="campaign-tabs">
          <TabsTrigger value="share" data-testid="tab-share">Share flows</TabsTrigger>
          <TabsTrigger value="advocates" data-testid="tab-advocates">Advocates</TabsTrigger>
          <TabsTrigger value="conversions" data-testid="tab-conversions">Conversions</TabsTrigger>
          <TabsTrigger value="rewards" data-testid="tab-rewards">Rewards</TabsTrigger>
        </TabsList>

        {/* Share flows */}
        <TabsContent value="share" className="mt-5 space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {share?.variants.map((v) => {
              const Icon = CHANNEL_ICON[v.channel] || Share2;
              return (
                <div key={v.channel} className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm" data-testid={`share-variant-${v.channel}`}>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <div className="h-8 w-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center"><Icon className="h-4 w-4" /></div>
                      <span className="font-medium capitalize text-slate-800">{v.channel.replace("_", " ")}</span>
                    </div>
                    {v.native_support ? (
                      <span className="text-xs text-emerald-600 flex items-center gap-1"><CheckCircle2 className="h-3 w-3" />native</span>
                    ) : (
                      <span className="text-xs text-amber-600">fallback copy</span>
                    )}
                  </div>
                  <p className="text-sm text-slate-600 bg-slate-50 rounded-lg p-3 min-h-[72px]">{v.copy}</p>
                  <div className="flex gap-2 mt-3">
                    <Button size="sm" variant="outline" onClick={() => copyText(v.copy)} data-testid={`copy-message-${v.channel}`}>
                      <Copy className="h-3.5 w-3.5 mr-1" /> Copy message
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => copyText(v.url)} data-testid={`copy-link-${v.channel}`}>
                      <Link2 className="h-3.5 w-3.5 mr-1" /> Copy link
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
          <p className="text-xs text-slate-400">Sample links shown for advocate <span className="font-medium">{share?.sample_advocate}</span>. Each advocate gets unique tracked links per channel.</p>
        </TabsContent>

        {/* Advocates */}
        <TabsContent value="advocates" className="mt-5 space-y-4">
          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
            <h3 className="font-medium text-slate-800 mb-3 flex items-center gap-2"><UserPlus className="h-4 w-4" /> Add advocate</h3>
            <div className="flex flex-wrap gap-3 items-end">
              <div className="flex-1 min-w-[180px]"><Label className="mb-1.5 block">Name</Label><Input value={refName} onChange={(e) => setRefName(e.target.value)} placeholder="Jamie Lee" data-testid="advocate-name-input" /></div>
              <div className="flex-1 min-w-[180px]"><Label className="mb-1.5 block">Email</Label><Input value={refEmail} onChange={(e) => setRefEmail(e.target.value)} placeholder="jamie@example.com" data-testid="advocate-email-input" /></div>
              <Button onClick={() => addRefMut.mutate()} disabled={!refName || !refEmail || addRefMut.isPending} className="bg-indigo-600 hover:bg-indigo-700" data-testid="add-advocate-button">Add & generate links</Button>
            </div>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
            <table className="w-full text-sm" data-testid="advocates-table">
              <thead><tr className="text-left text-slate-400 border-b border-slate-100 bg-slate-50/50">
                <th className="py-3 px-4 font-medium">Advocate</th><th className="py-3 px-4 font-medium">Code</th>
                <th className="py-3 px-4 font-medium">Channels</th><th className="py-3 px-4 font-medium">Clicks / Shares</th>
              </tr></thead>
              <tbody>
                {referrers.map((r) => (
                  <tr key={r.id} className="border-b border-slate-50 last:border-0">
                    <td className="py-3 px-4"><p className="font-medium text-slate-800">{r.name}</p><p className="text-xs text-slate-400">{r.email}</p></td>
                    <td className="py-3 px-4"><code className="text-xs bg-slate-100 px-2 py-1 rounded">{r.code}</code></td>
                    <td className="py-3 px-4 text-slate-600 capitalize">{r.links.map((l) => l.channel.replace("_", " ")).join(", ")}</td>
                    <td className="py-3 px-4 text-slate-600">{r.links.reduce((a, l) => a + l.clicks, 0)} / {r.links.reduce((a, l) => a + l.shares, 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TabsContent>

        {/* Conversions */}
        <TabsContent value="conversions" className="mt-5 space-y-4">
          <div className="flex justify-between items-center flex-wrap gap-2">
            <p className="text-sm text-slate-500">Webhook, demo & CSV conversions matched to advocates.</p>
            <label className="inline-flex">
              <input type="file" accept=".csv" className="hidden" onChange={importCsv} data-testid="csv-import-input" />
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium cursor-pointer hover:border-indigo-300 transition-colors"><Upload className="h-4 w-4" /> Import CSV</span>
            </label>
          </div>
          <ConversionsTable conversions={conversions} cur={cur} reviewMut={reviewMut} />
        </TabsContent>

        {/* Rewards */}
        <TabsContent value="rewards" className="mt-5">
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
            <table className="w-full text-sm" data-testid="campaign-rewards-table">
              <thead><tr className="text-left text-slate-400 border-b border-slate-100 bg-slate-50/50">
                <th className="py-3 px-4 font-medium">Advocate</th><th className="py-3 px-4 font-medium">Type</th>
                <th className="py-3 px-4 font-medium">Amount</th><th className="py-3 px-4 font-medium">Status</th>
              </tr></thead>
              <tbody>
                {(rewardsData?.rewards || []).map((r) => (
                  <tr key={r.id} className="border-b border-slate-50 last:border-0">
                    <td className="py-3 px-4 font-medium text-slate-800">{r.referrer_name}</td>
                    <td className="py-3 px-4 text-slate-600 capitalize">{r.type.replace("_", " ")}</td>
                    <td className="py-3 px-4 text-slate-600">{fmtMoney(r.amount, r.currency)}{r.rate ? ` · ${r.rate}% off` : ""}</td>
                    <td className="py-3 px-4"><StatusBadge status={r.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ConversionsTable({ conversions, cur, reviewMut }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
      <table className="w-full text-sm" data-testid="conversions-table">
        <thead><tr className="text-left text-slate-400 border-b border-slate-100 bg-slate-50/50">
          <th className="py-3 px-4 font-medium">Advocate</th><th className="py-3 px-4 font-medium">Order</th>
          <th className="py-3 px-4 font-medium">Source</th><th className="py-3 px-4 font-medium">Confidence</th>
          <th className="py-3 px-4 font-medium">Status</th><th className="py-3 px-4 font-medium">Actions</th>
        </tr></thead>
        <tbody>
          {conversions.length === 0 && (
            <tr><td colSpan={6} className="py-10 text-center text-slate-400">No conversions yet — try "Simulate conversion".</td></tr>
          )}
          {conversions.map((c) => (
            <tr key={c.id} className="border-b border-slate-50 last:border-0" data-testid={`conversion-row-${c.id}`}>
              <td className="py-3 px-4"><p className="font-medium text-slate-800">{c.referrer_name}</p><p className="text-xs text-slate-400">{c.customer_email}</p></td>
              <td className="py-3 px-4 text-slate-600">{fmtMoney(c.order_value, c.currency)}</td>
              <td className="py-3 px-4"><span className="text-xs capitalize bg-slate-100 px-2 py-0.5 rounded">{c.source}</span></td>
              <td className="py-3 px-4"><ConfidenceBadge label={c.confidence_label} value={c.confidence} /></td>
              <td className="py-3 px-4"><StatusBadge status={c.status} testId={`conversion-status-${c.id}`} /></td>
              <td className="py-3 px-4">
                {c.status !== "verified" && c.status !== "reversed" && (
                  <Button size="sm" variant="outline" className="h-7 text-xs mr-1" onClick={() => reviewMut.mutate({ convId: c.id, action: "approve" })} data-testid={`approve-${c.id}`}>Approve</Button>
                )}
                {c.status === "verified" && (
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => reviewMut.mutate({ convId: c.id, action: "reverse" })} data-testid={`reverse-${c.id}`}>Reverse</Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
