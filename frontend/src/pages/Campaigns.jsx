import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api, fmtMoney } from "@/lib/api";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Plus, Megaphone, ArrowRight, ShoppingBag, Repeat, Gift } from "lucide-react";
import { motion } from "framer-motion";

const TEMPLATES = [
  { id: "ecommerce_purchase", name: "Ecommerce Purchase", desc: "Reward friends who make their first purchase", icon: ShoppingBag, event: "purchase" },
  { id: "subscription_signup", name: "Subscription Signup", desc: "Reward referrals that start a subscription", icon: Repeat, event: "subscription" },
  { id: "custom_event", name: "Custom Event", desc: "Track any webhook event you define", icon: Gift, event: "custom" },
];

const defaultForm = {
  name: "", template: "ecommerce_purchase", conversion_event: "purchase", audience: "all_customers",
  reward_type: "discount", reward_value: 15, reward_currency: "USD",
  language: "en", budget_cap: 2000, approval_mode: "auto_verify",
  channels: ["whatsapp", "copy_link"], paid_cpa_benchmark: 42,
};

export default function Campaigns() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(defaultForm);

  const { data: campaigns = [], isLoading } = useQuery({
    queryKey: ["campaigns"],
    queryFn: async () => (await api.get("/campaigns")).data,
  });

  const createMut = useMutation({
    mutationFn: async (payload) => (await api.post("/campaigns", payload)).data,
    onSuccess: (camp) => {
      qc.invalidateQueries({ queryKey: ["campaigns"] });
      toast.success("Campaign created with starter advocates");
      setOpen(false);
      setForm(defaultForm);
      navigate(`/campaigns/${camp.id}`);
    },
    onError: () => toast.error("Could not create campaign"),
  });

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = () => {
    if (!form.name.trim()) return toast.error("Give your campaign a name");
    if (!form.channels.length) return toast.error("Pick at least one sharing channel");
    if (Number(form.reward_value) <= 0) return toast.error("Reward must be greater than 0");
    if (form.reward_type === "discount" && Number(form.reward_value) > 100) return toast.error("Discount can't exceed 100%");
    const tmpl = TEMPLATES.find((t) => t.id === form.template);
    createMut.mutate({ ...form, conversion_event: tmpl?.event || "purchase", reward_value: Number(form.reward_value), budget_cap: Number(form.budget_cap), paid_cpa_benchmark: Number(form.paid_cpa_benchmark) });
  };

  return (
    <div className="space-y-8" data-testid="campaigns-page">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold text-slate-900">Campaigns</h1>
          <p className="text-slate-500 mt-1">Build and manage your referral loops.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button data-testid="new-campaign-button" className="bg-indigo-600 hover:bg-indigo-700">
              <Plus className="h-4 w-4 mr-1" /> New campaign
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="campaign-builder-dialog">
            <DialogHeader>
              <DialogTitle className="font-display text-xl">Create campaign</DialogTitle>
            </DialogHeader>
            <div className="space-y-5 py-2">
              <div>
                <Label className="mb-1.5 block">Campaign name</Label>
                <Input data-testid="campaign-name-input" placeholder="e.g. Autumn Refer-a-Friend" value={form.name} onChange={(e) => set("name", e.target.value)} />
              </div>

              <div>
                <Label className="mb-2 block">Template</Label>
                <div className="grid grid-cols-3 gap-3">
                  {TEMPLATES.map((t) => (
                    <button
                      key={t.id}
                      data-testid={`template-${t.id}`}
                      onClick={() => { set("template", t.id); set("conversion_event", t.event); }}
                      className={`text-left rounded-lg border p-3 transition-all ${form.template === t.id ? "border-indigo-500 ring-2 ring-indigo-100 bg-indigo-50/50" : "border-slate-200 hover:border-slate-300"}`}
                    >
                      <t.icon className="h-5 w-5 text-indigo-600 mb-2" />
                      <p className="font-medium text-sm text-slate-800">{t.name}</p>
                      <p className="text-xs text-slate-500 mt-0.5">{t.desc}</p>
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <Label className="mb-1.5 block">Audience</Label>
                  <Select value={form.audience} onValueChange={(v) => set("audience", v)}>
                    <SelectTrigger data-testid="audience-select"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all_customers">All customers</SelectItem>
                      <SelectItem value="repeat_buyers">Repeat buyers</SelectItem>
                      <SelectItem value="vip">VIP / top spenders</SelectItem>
                      <SelectItem value="recent_buyers">Bought in last 30 days</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="mb-1.5 block">Sharing channels</Label>
                  <div className="flex gap-2">
                    {[["whatsapp", "WhatsApp"], ["copy_link", "Copy link"]].map(([id, label]) => {
                      const on = form.channels.includes(id);
                      return (
                        <button key={id} type="button" data-testid={`channel-toggle-${id}`}
                          onClick={() => set("channels", on ? form.channels.filter((c) => c !== id) : [...form.channels, id])}
                          className={`flex-1 rounded-md border px-3 py-2 text-sm transition-colors ${on ? "border-indigo-500 bg-indigo-50 text-indigo-700" : "border-slate-200 text-slate-500 hover:border-slate-300"}`}>
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="mb-1.5 block">Reward type</Label>
                  <Select value={form.reward_type} onValueChange={(v) => set("reward_type", v)}>
                    <SelectTrigger data-testid="reward-type-select"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="discount">Discount / coupon</SelectItem>
                      <SelectItem value="store_credit">Store credit</SelectItem>
                      <SelectItem value="cash">Fixed cash-equivalent</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="mb-1.5 block">{form.reward_type === "discount" ? "Discount %" : "Reward amount"}</Label>
                  <Input data-testid="reward-value-input" type="number" value={form.reward_value} onChange={(e) => set("reward_value", e.target.value)} />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <Label className="mb-1.5 block">Currency</Label>
                  <Select value={form.reward_currency} onValueChange={(v) => set("reward_currency", v)}>
                    <SelectTrigger data-testid="currency-select"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="USD">USD</SelectItem>
                      <SelectItem value="EUR">EUR</SelectItem>
                      <SelectItem value="GBP">GBP</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="mb-1.5 block">Language</Label>
                  <Select value={form.language} onValueChange={(v) => set("language", v)}>
                    <SelectTrigger data-testid="language-select"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="en">English</SelectItem>
                      <SelectItem value="es">Spanish</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="mb-1.5 block">Budget cap</Label>
                  <Input data-testid="budget-input" type="number" value={form.budget_cap} onChange={(e) => set("budget_cap", e.target.value)} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="mb-1.5 block">Approval strictness</Label>
                  <Select value={form.approval_mode} onValueChange={(v) => set("approval_mode", v)}>
                    <SelectTrigger data-testid="approval-mode-select"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto_verify">Auto-verify high confidence</SelectItem>
                      <SelectItem value="manual">Manual approval</SelectItem>
                      <SelectItem value="auto_approve">Auto-approve all</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="mb-1.5 block">Paid CPA benchmark</Label>
                  <Input data-testid="benchmark-input" type="number" value={form.paid_cpa_benchmark} onChange={(e) => set("paid_cpa_benchmark", e.target.value)} />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button data-testid="submit-campaign-button" onClick={submit} disabled={createMut.isPending} className="bg-indigo-600 hover:bg-indigo-700">
                {createMut.isPending ? "Creating…" : "Launch campaign"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <p className="text-slate-500">Loading campaigns…</p>
      ) : campaigns.length === 0 ? (
        <div className="bg-white border border-dashed border-slate-300 rounded-xl p-16 text-center">
          <Megaphone className="h-10 w-10 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-600 font-medium">No campaigns yet</p>
          <p className="text-slate-400 text-sm mt-1">Create your first referral campaign to get started.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {campaigns.map((c, i) => (
            <motion.div
              key={c.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: i * 0.04 }}
              onClick={() => navigate(`/campaigns/${c.id}`)}
              data-testid={`campaign-card-${c.id}`}
              className="group cursor-pointer bg-white border border-slate-200 rounded-xl p-5 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all"
            >
              <div className="flex items-start justify-between">
                <StatusBadge status={c.status} />
                <ArrowRight className="h-4 w-4 text-slate-300 group-hover:text-indigo-500 transition-colors" />
              </div>
              <h3 className="font-display text-lg font-semibold text-slate-900 mt-3">{c.name}</h3>
              <p className="text-sm text-slate-500 capitalize">{c.template.replace(/_/g, " ")} · {c.reward_type.replace("_", " ")}</p>
              <div className="grid grid-cols-3 gap-2 mt-4 pt-4 border-t border-slate-100">
                <div><p className="text-xs text-slate-400">Clicks</p><p className="font-semibold text-slate-800">{c.stats.clicks}</p></div>
                <div><p className="text-xs text-slate-400">Conv.</p><p className="font-semibold text-slate-800">{c.stats.conversions}</p></div>
                <div><p className="text-xs text-slate-400">Liability</p><p className="font-semibold text-slate-800">{fmtMoney(c.stats.approved_liability, c.reward_currency)}</p></div>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
