import { motion } from "framer-motion";
import { Repeat, TrendingUp, ShieldCheck, Share2, ArrowRight } from "lucide-react";

export default function Login() {
  const handleLogin = () => {
    // REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT URLS, THIS BREAKS THE AUTH
    const redirectUrl = window.location.origin + "/dashboard";
    window.location.href = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirectUrl)}`;
  };

  const features = [
    { icon: Share2, title: "Tracked share flows", desc: "WhatsApp-first links & copy variants per channel" },
    { icon: TrendingUp, title: "Referral vs paid CPA", desc: "Prove your second growth engine with real numbers" },
    { icon: ShieldCheck, title: "Trust states built-in", desc: "Pending, verified, reversed & flagged attribution" },
  ];

  return (
    <div className="min-h-screen grid lg:grid-cols-2 bg-slate-50">
      {/* Left: brand panel */}
      <div className="relative hidden lg:flex flex-col justify-between p-12 overflow-hidden bg-slate-950 text-white">
        <div className="absolute -top-24 -right-24 h-80 w-80 rounded-full bg-indigo-600/30 blur-3xl" />
        <div className="absolute bottom-0 -left-20 h-72 w-72 rounded-full bg-emerald-500/20 blur-3xl" />
        <div className="relative flex items-center gap-2">
          <div className="h-9 w-9 rounded-lg bg-indigo-500 flex items-center justify-center">
            <Repeat className="h-5 w-5" />
          </div>
          <span className="font-display text-xl font-bold">Loop Lab</span>
        </div>
        <div className="relative space-y-8">
          <h1 className="font-display text-5xl font-bold leading-tight">
            Turn customers into your <span className="text-indigo-400">second growth engine.</span>
          </h1>
          <p className="text-slate-300 text-lg max-w-md">
            Run measurable referral campaigns for your Shopify DTC brand — tracked sharing,
            flexible conversions, and real campaign analytics.
          </p>
          <div className="space-y-4">
            {features.map((f) => (
              <div key={f.title} className="flex items-start gap-3">
                <div className="h-9 w-9 rounded-lg bg-white/10 flex items-center justify-center shrink-0">
                  <f.icon className="h-4 w-4 text-indigo-300" />
                </div>
                <div>
                  <p className="font-medium">{f.title}</p>
                  <p className="text-sm text-slate-400">{f.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
        <p className="relative text-sm text-slate-500">Shopify DTC wedge · Liability tracking · No payouts in v1</p>
      </div>

      {/* Right: login */}
      <div className="flex items-center justify-center p-8">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="w-full max-w-md"
        >
          <div className="lg:hidden flex items-center gap-2 mb-8">
            <div className="h-9 w-9 rounded-lg bg-indigo-600 flex items-center justify-center text-white">
              <Repeat className="h-5 w-5" />
            </div>
            <span className="font-display text-xl font-bold">Loop Lab</span>
          </div>
          <h2 className="font-display text-3xl font-bold text-slate-900">Welcome back</h2>
          <p className="text-slate-500 mt-2 mb-8">
            Sign in to your brand workspace and launch your next referral loop.
          </p>
          <button
            data-testid="google-login-button"
            onClick={handleLogin}
            className="group w-full flex items-center justify-center gap-3 rounded-xl border border-slate-200 bg-white px-5 py-3.5 font-medium text-slate-800 shadow-sm hover:shadow hover:border-indigo-300 transition-all duration-200"
          >
            <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="" className="h-5 w-5" />
            Continue with Google
            <ArrowRight className="h-4 w-4 ml-1 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all" />
          </button>
          <p className="mt-6 text-xs text-slate-400 text-center">
            By continuing you agree to Loop Lab's terms. Your workspace comes preloaded with a demo campaign.
          </p>
        </motion.div>
      </div>
    </div>
  );
}
