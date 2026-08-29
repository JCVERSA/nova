import {
  Home,
  QrCode,
  Terminal,
  Cpu,
  Menu,
} from "lucide-react";
import { NavTab } from "./Sidebar";
import { ConnectionStatus } from "../lib/types";

interface MobileDockProps {
  activeTab: NavTab;
  setActiveTab: (tab: NavTab) => void;
  botStatus: ConnectionStatus | "pair_code";
  onOpenDrawer: () => void;
  isDrawerOpen: boolean;
}

export default function MobileDock({
  activeTab,
  setActiveTab,
  botStatus,
  onOpenDrawer,
  isDrawerOpen,
}: MobileDockProps) {
  // Check if active tab is one of the secondary tabs
  const isSecondaryActive =
    isDrawerOpen ||
    [
      "gemini",
      "plugins",
      "groups",
      "security",
      "analytics",
      "secrets",
      "logs",
      "settings",
      "docs",
      "export",
    ].includes(activeTab);

  return (
    <nav
      aria-label="Mobile Navigation Dock"
      className="md:hidden fixed left-1/2 -translate-x-1/2 bottom-3 z-40 w-[calc(100%-24px)] max-w-md pointer-events-auto select-none"
      style={{
        bottom: "calc(12px + env(safe-area-inset-bottom, 0px))",
      }}
    >
      <div className="relative flex items-center justify-between gap-1 p-1.5 rounded-full bg-[#0d0d11]/85 backdrop-blur-xl border border-white/15 shadow-[0_12px_36px_rgba(0,0,0,0.6),inset_0_1px_1px_rgba(255,255,255,0.25)]">
        {/* 1. Overview (Home) */}
        <button
          onClick={() => setActiveTab("overview")}
          className={`relative flex flex-1 flex-col items-center justify-center py-2 px-1 rounded-full transition-all duration-200 cursor-pointer active:scale-95 ${
            activeTab === "overview" && !isDrawerOpen
              ? "bg-amber-500/20 text-amber-400 font-bold border border-amber-500/30 shadow-[inset_0_1px_2px_rgba(255,255,255,0.2),0_4px_12px_rgba(245,158,11,0.2)]"
              : "text-zinc-400 hover:text-zinc-200 hover:bg-white/5"
          }`}
        >
          <Home className="w-4 h-4" />
          <span className="text-[10px] font-semibold mt-1 leading-none tracking-tight">Home</span>
        </button>

        {/* 2. Connect */}
        <button
          onClick={() => setActiveTab("connect")}
          className={`relative flex flex-1 flex-col items-center justify-center py-2 px-1 rounded-full transition-all duration-200 cursor-pointer active:scale-95 ${
            activeTab === "connect" && !isDrawerOpen
              ? "bg-amber-500/20 text-amber-400 font-bold border border-amber-500/30 shadow-[inset_0_1px_2px_rgba(255,255,255,0.2),0_4px_12px_rgba(245,158,11,0.2)]"
              : "text-zinc-400 hover:text-zinc-200 hover:bg-white/5"
          }`}
        >
          <div className="relative">
            <QrCode className="w-4 h-4" />
            <span
              className={`absolute -top-0.5 -right-1 h-2 w-2 rounded-full ring-2 ring-[#0d0d11] ${
                botStatus === "connected"
                  ? "bg-emerald-400 animate-pulse"
                  : botStatus === "connecting" || botStatus === "qr_ready" || botStatus === "pair_code"
                  ? "bg-amber-400 animate-pulse"
                  : "bg-zinc-600"
              }`}
            />
          </div>
          <span className="text-[10px] font-semibold mt-1 leading-none tracking-tight">Connect</span>
        </button>

        {/* 3. Simulator */}
        <button
          onClick={() => setActiveTab("simulator")}
          className={`relative flex flex-1 flex-col items-center justify-center py-2 px-1 rounded-full transition-all duration-200 cursor-pointer active:scale-95 ${
            activeTab === "simulator" && !isDrawerOpen
              ? "bg-amber-500/20 text-amber-400 font-bold border border-amber-500/30 shadow-[inset_0_1px_2px_rgba(255,255,255,0.2),0_4px_12px_rgba(245,158,11,0.2)]"
              : "text-zinc-400 hover:text-zinc-200 hover:bg-white/5"
          }`}
        >
          <Terminal className="w-4 h-4" />
          <span className="text-[10px] font-semibold mt-1 leading-none tracking-tight">Simulator</span>
        </button>

        {/* 4. Commands */}
        <button
          onClick={() => setActiveTab("commands")}
          className={`relative flex flex-1 flex-col items-center justify-center py-2 px-1 rounded-full transition-all duration-200 cursor-pointer active:scale-95 ${
            activeTab === "commands" && !isDrawerOpen
              ? "bg-amber-500/20 text-amber-400 font-bold border border-amber-500/30 shadow-[inset_0_1px_2px_rgba(255,255,255,0.2),0_4px_12px_rgba(245,158,11,0.2)]"
              : "text-zinc-400 hover:text-zinc-200 hover:bg-white/5"
          }`}
        >
          <Cpu className="w-4 h-4" />
          <span className="text-[10px] font-semibold mt-1 leading-none tracking-tight">Commands</span>
        </button>

        {/* 5. More Menu Drawer */}
        <button
          onClick={onOpenDrawer}
          className={`relative flex flex-1 flex-col items-center justify-center py-2 px-1 rounded-full transition-all duration-200 cursor-pointer active:scale-95 ${
            isSecondaryActive
              ? "bg-amber-500/20 text-amber-400 font-bold border border-amber-500/30 shadow-[inset_0_1px_2px_rgba(255,255,255,0.2),0_4px_12px_rgba(245,158,11,0.2)]"
              : "text-zinc-400 hover:text-zinc-200 hover:bg-white/5"
          }`}
        >
          <Menu className="w-4 h-4" />
          <span className="text-[10px] font-semibold mt-1 leading-none tracking-tight">
            {isDrawerOpen ? "Close" : "More"}
          </span>
        </button>
      </div>
    </nav>
  );
}
