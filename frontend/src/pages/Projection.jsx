import { useState, useEffect, useMemo } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from "recharts";
import { CampaignSwitcher } from "@/components/CampaignSwitcher";
import { useKFactor, fmtCycle } from "@/components/KFactorPanel";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { FlaskConical } from "lucide-react";

const project = ({ start, k, cycles, cycleDays, network, lift }) => {
  const rows = [];
  let wave = start;
  let total = start;
  let base = start;
  rows.push({ cycle: 0, day: 0, measured: Math.round(base), hypothesis: network ? Math.round(total) : undefined });
  for (let n = 1; n <= cycles; n++) {
    base = base + start * Math.pow(k, n);
    const kn = k + lift * (total / 100);
    wave = wave * kn;
    total += wave;
    rows.push({ cycle: n, day: +(n * cycleDays).toFixed(1), measured: Math.round(base), hypothesis: network ? Math.round(total) : undefined });
  }
  return rows;
};

function Field({ label, children }) {
  return <div><Label className="mb-1.5 block text-xs text-slate-500">{label}</Label>{children}</div>;
}

export default function Projection() {
  const [cid, setCid] = useState(null);
  const { data: kf } = useKFactor(cid);
  const [form, setForm] = useState({ start: 100, k: 0, cycles: 6, cycleDays: 7, lift: 0.02 });
  const [network, setNetwork] = useState(false);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: Number(e.target.value) }));

  useEffect(() => {
    if (kf) {
      setForm((f) => ({ ...f, k: Math.round(kf.k * 100) / 100, cycleDays: kf.cycle_time_hours ? +(kf.cycle_time_hours / 24).toFixed(1) : f.cycleDays }));
    }
  }, [kf?.campaign_id, kf?.k, kf?.cycle_time_hours]); // eslint-disable-line react-hooks/exhaustive-deps

  const rows = useMemo(() => project({ ...form, cycles: Math.min(24, Math.max(1, form.cycles)), network }), [form, network]);
  const last = rows[rows.length - 1];

  return (
    <div className="space-y-6" data-testid="projection-page">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold text-slate-900">Growth projection</h1>
          <p className="text-slate-500 mt-1">What the measured K and cycle time imply if they hold.</p>
        </div>
        <CampaignSwitcher value={cid} onChange={setCid} testId="projection-campaign-switcher" />
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm grid grid-cols-2 md:grid-cols-4 gap-4">
        <Field label="Starting customers"><Input type="number" min={1} value={form.start} onChange={set("start")} data-testid="projection-start-input" /></Field>
        <Field label={`K (measured ${kf ? kf.k.toFixed(2) : "–"})`}><Input type="number" step="0.01" min={0} value={form.k} onChange={set("k")} data-testid="projection-k-input" /></Field>
        <Field label={`Cycle days (measured ${kf ? fmtCycle(kf.cycle_time_hours) : "–"})`}><Input type="number" step="0.1" min={0.1} value={form.cycleDays} onChange={set("cycleDays")} data-testid="projection-cycle-input" /></Field>
        <Field label="Cycles"><Input type="number" min={1} max={24} value={form.cycles} onChange={set("cycles")} data-testid="projection-cycles-input" /></Field>
      </div>

      <div className="bg-amber-50/60 border border-amber-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
        <div className="flex items-center gap-3">
          <Switch checked={network} onCheckedChange={setNetwork} data-testid="projection-network-toggle" />
          <div>
            <p className="text-sm font-medium text-slate-800 flex items-center gap-1.5"><FlaskConical className="h-4 w-4 text-amber-600" /> Network effect</p>
            <p className="text-xs text-amber-700 font-medium" data-testid="projection-hypothesis-label">Hypothesis, not measured: K rises as more people join.</p>
          </div>
        </div>
        {network && (
          <div className="w-full sm:w-56"><Field label="K lift per 100 customers"><Input type="number" step="0.01" min={0} value={form.lift} onChange={set("lift")} data-testid="projection-lift-input" /></Field></div>
        )}
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
        <div className="flex flex-wrap gap-6 mb-4">
          <div data-testid="projection-total-measured"><p className="text-xs text-slate-400 uppercase tracking-wider">Customers after {last.day} days</p><p className="font-display text-2xl font-bold text-slate-900">{last.measured.toLocaleString()}</p></div>
          {network && <div data-testid="projection-total-hypothesis"><p className="text-xs text-amber-600 uppercase tracking-wider">With network effect (hypothesis)</p><p className="font-display text-2xl font-bold text-amber-700">{last.hypothesis.toLocaleString()}</p></div>}
        </div>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={rows} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
            <XAxis dataKey="day" tick={{ fontSize: 12, fill: "#64748b" }} tickFormatter={(d) => `d${d}`} />
            <YAxis tick={{ fontSize: 12, fill: "#94a3b8" }} />
            <Tooltip formatter={(v) => v.toLocaleString()} labelFormatter={(d) => `Day ${d}`} />
            <Legend />
            <Line type="monotone" dataKey="measured" name="Measured K" stroke="#6366f1" strokeWidth={2.5} dot={false} />
            {network && <Line type="monotone" dataKey="hypothesis" name="Network effect (hypothesis, not measured)" stroke="#f59e0b" strokeDasharray="5 4" strokeWidth={2} dot={false} />}
          </LineChart>
        </ResponsiveContainer>
        <p className="text-xs text-slate-400 mt-3">Cumulative customers. Each cycle adds the previous wave × K. A projection, not a forecast.</p>
      </div>
    </div>
  );
}
