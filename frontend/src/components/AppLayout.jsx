import { useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet";
import { useAuth } from "@/context/AuthContext";
import {
  Repeat, LayoutDashboard, Megaphone, Target, Coins, ShieldAlert, Settings, LogOut, LineChart, Menu,
} from "lucide-react";

const NAV = [
  { to: "/dashboard", label: "Overview", icon: LayoutDashboard, testId: "nav-overview" },
  { to: "/campaigns", label: "Campaigns", icon: Megaphone, testId: "nav-campaigns" },
  { to: "/projection", label: "Projection", icon: LineChart, testId: "nav-projection" },
  { to: "/conversions", label: "Conversions", icon: Target, testId: "nav-conversions" },
  { to: "/rewards", label: "Reward Ledger", icon: Coins, testId: "nav-rewards" },
  { to: "/abuse", label: "Abuse Queue", icon: ShieldAlert, testId: "nav-abuse" },
  { to: "/settings", label: "Settings", icon: Settings, testId: "nav-settings" },
];

export default function AppLayout({ children }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const sidebar = (
    <>
        <div
          className="h-16 flex items-center gap-2 px-5 border-b border-white/10 cursor-pointer"
          onClick={() => navigate("/dashboard")}
          data-testid="sidebar-logo"
        >
          <div className="h-8 w-8 rounded-lg bg-indigo-500 flex items-center justify-center text-white">
            <Repeat className="h-4 w-4" />
          </div>
          <span className="font-display text-lg font-bold text-white">Loop Lab</span>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/dashboard"}
              data-testid={item.testId}
              onClick={() => setOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-indigo-500/15 text-white border border-indigo-500/30"
                    : "text-slate-400 hover:text-white hover:bg-white/5 border border-transparent"
                }`
              }
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="p-3 border-t border-white/10">
          <div className="flex items-center gap-3 px-2 py-2">
            {user?.picture ? (
              <img src={user.picture} alt="" className="h-8 w-8 rounded-full" />
            ) : (
              <div className="h-8 w-8 rounded-full bg-indigo-500 flex items-center justify-center text-white text-sm font-semibold">
                {user?.name?.[0] || "U"}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-white truncate">{user?.name}</p>
              <p className="text-xs text-slate-500 truncate">{user?.email}</p>
            </div>
          </div>
          <button
            onClick={logout}
            data-testid="logout-button"
            className="mt-1 w-full flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </div>
    </>
  );

  return (
    <div className="min-h-screen bg-slate-50">
      <aside className="hidden md:flex fixed inset-y-0 left-0 w-64 bg-slate-950 text-slate-300 flex-col z-30">
        {sidebar}
      </aside>

      <header className="md:hidden sticky top-0 z-30 h-14 bg-slate-950 flex items-center justify-between px-4">
        <div className="flex items-center gap-2" onClick={() => navigate("/dashboard")}>
          <div className="h-7 w-7 rounded-lg bg-indigo-500 flex items-center justify-center text-white"><Repeat className="h-4 w-4" /></div>
          <span className="font-display font-bold text-white">Loop Lab</span>
        </div>
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <button className="text-slate-300 p-2" data-testid="mobile-menu-button" aria-label="Open menu"><Menu className="h-5 w-5" /></button>
          </SheetTrigger>
          <SheetContent side="left" className="w-64 p-0 bg-slate-950 text-slate-300 border-white/10 flex flex-col" data-testid="mobile-menu">
            <SheetTitle className="sr-only">Menu</SheetTitle>
            {sidebar}
          </SheetContent>
        </Sheet>
      </header>

      <main className="md:pl-64 min-w-0">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 md:px-8 py-6 md:py-8">{children}</div>
      </main>
    </div>
  );
}
