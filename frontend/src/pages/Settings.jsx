import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Copy, Webhook, Store, Building2 } from "lucide-react";

export default function Settings() {
  const qc = useQueryClient();
  const { data: ws } = useQuery({ queryKey: ["workspace"], queryFn: async () => (await api.get("/workspace")).data });
  const [form, setForm] = useState({ name: "", currency: "USD", shopify_domain: "" });

  useEffect(() => {
    if (ws) setForm({ name: ws.name || "", currency: ws.currency || "USD", shopify_domain: ws.shopify_domain || "" });
  }, [ws]);

  const saveMut = useMutation({
    mutationFn: async () => (await api.put("/workspace", form)).data,
    onSuccess: () => { toast.success("Workspace updated"); qc.invalidateQueries({ queryKey: ["workspace"] }); qc.invalidateQueries({ queryKey: ["analytics"] }); },
  });

  const fullWebhook = ws ? `${process.env.REACT_APP_BACKEND_URL}${ws.webhook_url}` : "";
  const copy = (t) => { navigator.clipboard?.writeText(t); toast.success("Copied"); };

  if (!ws) return <p className="text-slate-500">Loading settings…</p>;

  return (
    <div className="space-y-6 max-w-3xl" data-testid="settings-page">
      <div>
        <h1 className="font-display text-3xl font-bold text-slate-900">Settings</h1>
        <p className="text-slate-500 mt-1">Brand workspace, currency & conversion integrations.</p>
      </div>

      {/* Brand settings */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm space-y-4">
        <h2 className="font-display text-lg font-semibold text-slate-900 flex items-center gap-2"><Building2 className="h-5 w-5 text-indigo-600" /> Brand</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div><Label className="mb-1.5 block">Brand / workspace name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="workspace-name-input" /></div>
          <div>
            <Label className="mb-1.5 block">Base reporting currency</Label>
            <Select value={form.currency} onValueChange={(v) => setForm({ ...form, currency: v })}>
              <SelectTrigger data-testid="workspace-currency-select"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="USD">USD</SelectItem><SelectItem value="EUR">EUR</SelectItem><SelectItem value="GBP">GBP</SelectItem></SelectContent>
            </Select>
          </div>
        </div>
        <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending} className="bg-indigo-600 hover:bg-indigo-700" data-testid="save-workspace-button">Save changes</Button>
      </div>

      {/* Shopify */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm space-y-4">
        <h2 className="font-display text-lg font-semibold text-slate-900 flex items-center gap-2"><Store className="h-5 w-5 text-emerald-600" /> Shopify connection</h2>
        <p className="text-sm text-slate-500">Enter your store domain to label purchase conversions. Demo mode works without a live store.</p>
        <div><Label className="mb-1.5 block">Shopify store domain</Label><Input placeholder="your-brand.myshopify.com" value={form.shopify_domain} onChange={(e) => setForm({ ...form, shopify_domain: e.target.value })} data-testid="shopify-domain-input" /></div>
        <Button variant="outline" onClick={() => saveMut.mutate()} data-testid="save-shopify-button">Save store</Button>
      </div>

      {/* Webhook */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm space-y-4">
        <h2 className="font-display text-lg font-semibold text-slate-900 flex items-center gap-2"><Webhook className="h-5 w-5 text-sky-600" /> Conversion webhook</h2>
        <p className="text-sm text-slate-500">POST purchase / custom conversion events here with a referral <code className="bg-slate-100 px-1 rounded">code</code>. Shopify or any app can call this endpoint.</p>
        <div className="flex gap-2">
          <Input readOnly value={fullWebhook} className="font-mono text-xs" data-testid="webhook-url" />
          <Button variant="outline" onClick={() => copy(fullWebhook)} data-testid="copy-webhook-button"><Copy className="h-4 w-4" /></Button>
        </div>
        <pre className="bg-slate-950 text-slate-200 rounded-lg p-4 text-xs overflow-x-auto" data-testid="webhook-example">{`curl -X POST ${fullWebhook} \\
  -H "Content-Type: application/json" \\
  -d '{
    "code": "AVA1234",
    "event_type": "purchase",
    "order_value": 89.00,
    "currency": "USD",
    "customer_email": "friend@example.com",
    "device_fingerprint": "fp_abc123"
  }'`}</pre>
      </div>
    </div>
  );
}
