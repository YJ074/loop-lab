import { CheckCircle2, Clock, RotateCcw, AlertTriangle, XCircle } from "lucide-react";

const MAP = {
  verified: { label: "Verified", cls: "bg-emerald-50 text-emerald-700 border-emerald-200", icon: CheckCircle2 },
  approved: { label: "Approved", cls: "bg-emerald-50 text-emerald-700 border-emerald-200", icon: CheckCircle2 },
  pending: { label: "Pending", cls: "bg-amber-50 text-amber-700 border-amber-200", icon: Clock },
  reversed: { label: "Reversed", cls: "bg-slate-100 text-slate-600 border-slate-200", icon: RotateCcw },
  rejected: { label: "Rejected", cls: "bg-slate-100 text-slate-600 border-slate-200", icon: XCircle },
  flagged: { label: "Flagged", cls: "bg-red-50 text-red-700 border-red-200", icon: AlertTriangle },
  active: { label: "Active", cls: "bg-emerald-50 text-emerald-700 border-emerald-200", icon: CheckCircle2 },
  paused: { label: "Paused", cls: "bg-slate-100 text-slate-600 border-slate-200", icon: Clock },
};

export function StatusBadge({ status, testId }) {
  const m = MAP[status] || { label: status, cls: "bg-slate-100 text-slate-600 border-slate-200", icon: Clock };
  const Icon = m.icon;
  return (
    <span
      data-testid={testId}
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium ${m.cls}`}
    >
      <Icon className="h-3 w-3" />
      {m.label}
    </span>
  );
}

export function ConfidenceBadge({ label, value }) {
  const cls =
    label === "high"
      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
      : label === "medium"
      ? "bg-amber-50 text-amber-700 border-amber-200"
      : "bg-red-50 text-red-700 border-red-200";
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${cls}`}>
      {value}% · {label}
    </span>
  );
}
