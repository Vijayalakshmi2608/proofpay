import { useCallback, useEffect, useState } from "react";
import { ChevronRight, Menu, RefreshCw, Wallet } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { getAccountBalanceYocto } from "@/lib/near-rpc";
import { nearBalanceFromYocto, shorten } from "@/lib/milestone-utils";
import { useWallet } from "@/components/wallet-provider";

export function Navbar({ isDemoMode, activeSection, onMenuClick }: { isDemoMode: boolean; activeSection: string; onMenuClick: () => void }) {
  const { accountId, connect, disconnect, isConnecting, isReady, network } = useWallet();
  const [balance, setBalance] = useState<string | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [balanceError, setBalanceError] = useState(false);

  const refreshBalance = useCallback(async () => {
    if (!accountId) {
      setBalance(null);
      setBalanceError(false);
      return;
    }
    setBalanceLoading(true);
    try {
      const amount = await getAccountBalanceYocto(accountId, network);
      setBalance(nearBalanceFromYocto(amount));
      setBalanceError(false);
    } catch {
      setBalanceError(true);
    } finally {
      setBalanceLoading(false);
    }
  }, [accountId, network]);

  useEffect(() => {
    void refreshBalance();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refreshBalance();
    }, 15_000);
    const onVisible = () => { if (document.visibilityState === "visible") void refreshBalance(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refreshBalance]);

  const onDisconnect = async () => {
    try {
      await disconnect();
      toast.success("Wallet disconnected");
    } catch {
      toast.error("Wallet could not be disconnected");
    }
  };

  return (
    <header className="sticky top-0 z-20 flex h-[72px] items-center justify-between border-b border-white/[0.06] bg-[#0b0f17]/85 px-4 backdrop-blur-xl sm:px-7 lg:px-10">
      <div className="flex min-w-0 items-center gap-3">
        <button className="rounded-lg p-2 text-slate-400 hover:bg-white/[0.05] lg:hidden" onClick={onMenuClick} aria-label="Open navigation"><Menu size={18} /></button>
        <div className="hidden items-center gap-2 text-xs text-slate-500 sm:flex"><span>Workspace</span><ChevronRight size={12} /><span className="text-slate-200">{activeSection}</span></div>
        <span className="truncate text-sm font-semibold text-white sm:hidden">Proof<span className="text-proof">Pay</span></span>
      </div>
      <div className="flex shrink-0 items-center gap-2 sm:gap-3">
        <span className="hidden items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.02] px-2.5 py-1.5 text-[10px] text-slate-400 md:flex" aria-label={`NEAR ${network}`}>
          <i className="h-1.5 w-1.5 rounded-full bg-proof shadow-[0_0_8px_rgba(0,236,66,.8)]" />
          NEAR {network === "testnet" ? "Testnet" : "Mainnet"}
          {isDemoMode && <span className="border-l border-white/10 pl-2 text-amber-200/80">DEMO</span>}
        </span>
        {accountId && <div className="hidden items-center gap-2 rounded-lg border border-white/[0.07] bg-white/[0.025] px-3 py-1.5 sm:flex">
          <Wallet size={13} className="text-proof" />
          <span className="font-mono text-[10px] text-slate-200">{balanceLoading ? "Reading…" : balanceError ? "Balance unavailable" : `${balance ?? "—"} NEAR`}</span>
          <button onClick={() => void refreshBalance()} aria-label="Refresh NEAR balance" className="rounded p-0.5 text-slate-500 hover:text-proof"><RefreshCw size={11} className={balanceLoading ? "animate-spin" : ""} /></button>
        </div>}
        {accountId ? <Button size="sm" variant="secondary" onClick={() => void onDisconnect()} className="max-w-[148px]">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-proof" /><span className="truncate font-mono text-[10px]">{shorten(accountId, 8, 4)}</span>
        </Button> : <Button size="sm" onClick={connect} disabled={!isReady || isConnecting}>
          <Wallet size={14} />{isConnecting ? "Opening…" : !isReady ? "Loading…" : "Connect wallet"}
        </Button>}
      </div>
    </header>
  );
}
