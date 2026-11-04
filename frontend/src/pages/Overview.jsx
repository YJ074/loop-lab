import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { KFactorPanel } from "@/components/KFactorPanel";
import { CampaignSwitcher } from "@/components/CampaignSwitcher";
import { api, fmtMoney } from "@/lib/api";
import { StatCard } from "@/components/StatCard";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell,
} from "recharts";
import {
  Share2, MousePointerClick, Target, CheckCircle2, Coins, Gauge, TrendingUp, ShieldAlert,
} from "lucide-react";

const FUNNEL_COLORS = ["#6366f1", "#818cf8", "#34d399", "#10b981"];

export default function Overview() {
  const [kCampaign, setKCampaign] = useState(null);
  const { data, isLoading } = useQuery({
    queryKey: ["analytics"],
    queryFn: async () => (await api.get("/analytics/overview")).data,
    refetchInterval: 5000,
  });

  if (isLoading || !data) {
    return <div className="text-slate-500" data-testid="overview-loading">Loading analytics…</div>;
  }

  const k = data.kpis;
  const funnelData = [
    { stage: "Shares", value: data.funnel.shares },
    { stage: "Clicks", value: data.funnel.clicks },
    { stage: "Conversions", value: data.funnel.conversions },
    { stage: "Verified", value: data.funnel.verified },
  ];
  const cur = data.base_currency;
  const cpaWin = k.cpa > 0 && k.cpa < k.paid_cpa_benchmark;

  return (
    <div className="space-y-8" data-testid="overview-page">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold text-slate-900">Overview</h1>
          <p className="text-slate-500 mt-1">Your referral engine at a glance.</p>
        </div>
        <CampaignSwitcher value={kCampaign} onChange={setKCampaign} testId="overview-campaign-switcher" />
      </div>

      <KFactorPanel campaignId={kCampaign} />

      <div className="grid grid-cols-1 md:grid-cols-4 gap-5">
        <StatCard testId="kpi-shares" label="Shares" value={k.shares.toLocaleString()} icon={Share2} accent="indigo" delay={0} />
        <StatCard testId="kpi-clicks" label="Clicks" value={k.clicks.toLocaleString()} sub={`${k.ctr}% click-through`} icon={MousePointerClick} accent="sky" delay={0.05} />
        <StatCard testId="kpi-conversions" label="Conversions" value={k.conversions} sub={`${k.cvr}% of clicks`} icon={Target} accent="emerald" delay={0.1} />
        <StatCard testId="kpi-verified" label="Verified" value={k.verified} sub={`${k.flagged} flagged`} icon={CheckCircle2} accent="emerald" delay={0.15} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Funnel */}
        <div className="lg:col-span-2 bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display text-lg font-semibold text-slate-900">Referral funnel</h2>
            <span className="text-xs text-slate-400">shares → clicks → conversions → verified</span>
          </div>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={funnelData} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
              <XAxis dataKey="stage" tick={{ fontSize: 12, fill: "#64748b" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 12, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
              <Tooltip cursor={{ fill: "#f8fafc" }} contentStyle={{ borderRadius: 10, border: "1px solid #e2e8f0" }} />
              <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                {funnelData.map((_, i) => (
                  <Cell key={i} fill={FUNNEL_COLORS[i]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* CPA vs paid */}
        <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm flex flex-col">
          <h2 className="font-display text-lg font-semibold text-slate-900 mb-4">Referral vs paid CPA</h2>
          <div className="space-y-5 flex-1">
            <div>
              <div className="flex items-center justify-between text-sm mb-1">
                <span className="flex items-center gap-1.5 text-indigo-600 font-medium"><Gauge className="h-4 w-4" />Referral CPA</span>
                <span className="font-semibold">{fmtMoney(k.cpa, cur)}</span>
              </div>
              <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${Math.min(100, (k.cpa / (k.paid_cpa_benchmark || 1)) * 100)}%` }} />
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between text-sm mb-1">
                <span className="flex items-center gap-1.5 text-slate-500 font-medium"><TrendingUp className="h-4 w-4" />Paid benchmark</span>
                <span className="font-semibold">{fmtMoney(k.paid_cpa_benchmark, cur)}</span>
              </div>
              <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                <div className="h-full bg-slate-400 rounded-full w-full" />
              </div>
            </div>
          </div>
          <div className={`mt-4 rounded-lg px-4 py-3 text-sm font-medium ${cpaWin ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`} data-testid="cpa-verdict">
            {cpaWin
              ? `Referrals are ${Math.round((1 - k.cpa / k.paid_cpa_benchmark) * 100)}% cheaper than paid.`
              : "Referral CPA is tracking close to paid — keep optimizing."}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <StatCard testId="kpi-approved-liability" label="Approved liability" value={fmtMoney(k.approved_liability, cur)} sub="owed, not paid out" icon={Coins} accent="emerald" />
        <StatCard testId="kpi-pending-liability" label="Pending liability" value={fmtMoney(k.pending_liability, cur)} sub="awaiting verification" icon={Coins} accent="amber" />
        <StatCard testId="kpi-active-campaigns" label="Active campaigns" value={k.active_campaigns} sub={`${k.flagged} conversions flagged`} icon={ShieldAlert} accent="indigo" />
      </div>

      {/* Channel performance */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
        <h2 className="font-display text-lg font-semibold text-slate-900 mb-4">Message / channel performance</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="channel-performance-table">
            <thead>
              <tr className="text-left text-slate-400 border-b border-slate-100">
                <th className="py-2 font-medium">Channel</th>
                <th className="py-2 font-medium">Shares</th>
                <th className="py-2 font-medium">Clicks</th>
                <th className="py-2 font-medium">Conversions</th>
                <th className="py-2 font-medium">Conv. rate</th>
              </tr>
            </thead>
            <tbody>
              {data.channel_performance.map((c) => (
                <tr key={c.channel} className="border-b border-slate-50 last:border-0">
                  <td className="py-3 font-medium capitalize text-slate-800">{c.channel.replace("_", " ")}</td>
                  <td className="py-3 text-slate-600">{c.shares}</td>
                  <td className="py-3 text-slate-600">{c.clicks}</td>
                  <td className="py-3 text-slate-600">{c.conversions}</td>
                  <td className="py-3 text-slate-600">{c.clicks ? ((c.conversions / c.clicks) * 100).toFixed(1) : 0}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Campaign comparison */}
      {data.comparison.length > 1 && (
        <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
          <h2 className="font-display text-lg font-semibold text-slate-900 mb-4">Campaign comparison</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-400 border-b border-slate-100">
                  <th className="py-2 font-medium">Campaign</th>
                  <th className="py-2 font-medium">Clicks</th>
                  <th className="py-2 font-medium">Conversions</th>
                  <th className="py-2 font-medium">CPA</th>
                  <th className="py-2 font-medium">Liability</th>
                </tr>
              </thead>
              <tbody>
                {data.comparison.map((c) => (
                  <tr key={c.name} className="border-b border-slate-50 last:border-0">
                    <td className="py-3 font-medium text-slate-800">{c.name}</td>
                    <td className="py-3 text-slate-600">{c.clicks}</td>
                    <td className="py-3 text-slate-600">{c.conversions}</td>
                    <td className="py-3 text-slate-600">{fmtMoney(c.cpa, c.reward_currency)}</td>
                    <td className="py-3 text-slate-600">{fmtMoney(c.approved_liability, c.reward_currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
