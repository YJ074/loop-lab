import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";

export function CampaignSwitcher({ value, onChange, testId = "campaign-switcher" }) {
  const { data: campaigns = [] } = useQuery({
    queryKey: ["campaigns"],
    queryFn: async () => (await api.get("/campaigns")).data,
  });
  useEffect(() => {
    if (!value && campaigns.length) {
      onChange(campaigns[0].id);
    }
  }, [value, campaigns, onChange]);
  if (!campaigns.length) return null;
  return (
    <Select value={value || ""} onValueChange={onChange}>
      <SelectTrigger className="w-full sm:w-72 bg-white" data-testid={testId}><SelectValue placeholder="Choose campaign" /></SelectTrigger>
      <SelectContent>
        {campaigns.map((c) => (
          <SelectItem key={c.id} value={c.id} data-testid={`campaign-option-${c.id}`}>{c.name}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
