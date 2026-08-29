import type { ReactNode } from "react";
import {
  X,
  Home,
  QrCode,
  Terminal,
  Cpu,
  Sparkles,
  Package,
  Users,
  ShieldAlert,
  BarChart2,
  Settings,
  KeyRound,
  FileText,
  BookOpen,
  FileDown,
  Activity,
  RotateCcw,
  Power,
  Zap,
} from "lucide-react";
import { NavTab } from "./Sidebar";
import { ConnectionStatus } from "../lib/types";

interface MobileDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  activeTab: NavTab;
  setActiveTab: (tab: NavTab) => void;
  botStatus: ConnectionStatus | "pair_code";
  onRunCheckup: () => void;
  onResetSession: () => void;
  isResetting: boolean;
  onToggleBot: () => void;
  isStarting: boolean;
}

interface DrawerItem {
  id: NavTab;
  label: string;
  icon: ReactNode;
  badge?: string;
  category: "start" | "manage" | "admin" | "dev";
}

const ITEMS: DrawerItem[] = [
  // Getting started
  { id: "overview", label: "Overview", icon: <Home size={18} />, category: "start" },
  { id: "connect", label: "WhatsApp Connect", icon: <QrCode size={18} />, category: "start" },
  { id: "simulator", label: "Simulator", icon: <Terminal size={18} />, category: "start" },

  // Manage
  { id: "commands", label: "Commands Registry", icon: <Cpu size={18} />, category: "manage" },
  { id: "gemini", label: "Gemini AI Engine", icon: <Sparkles size={18} />, category: "manage" },
  { id: "plugins", label: "Plugins & Scrapers", icon: <Package size={18} />, category: "manage" },

  // Admin
  { id: "groups", label: "Group Tools", icon: <Users size={18} />, category: "admin" },
  { id: "security", label: "Security & Antilink", icon: <ShieldAlert size={18} />, category: "admin" },
  { id: "analytics", label: "Analytics & Usage", icon: <BarChart2 size={18} />, category: "admin" },
  { id: "settings", label: "Bot Settings", icon: <Settings size={18} />, category: "admin" },

  // Developer
  { id: "secrets", label: "API Secrets", icon: <KeyRound size={18} />, category: "dev" },
  { id: "logs", label: "Console Logs", icon: <FileText size={18} />, category: "dev" },
  { id: "docs", label: "Documentation", icon: <BookOpen size={18} />, category: "dev" },
  { id: "export", label: "Export Codebase", icon: <FileDown size={18} />, category: "dev" },
];

export default function MobileDrawer({
  isOpen,
  onClose,
  activeTab,
  setActiveTab,
  botStatus,
  onRunCheckup,
  onResetSession,
  isResetting,
  onToggleBot,
  isStarting,
}: MobileDrawerProps) {
  if (!isOpen) return null;

  const handleSelect = (tab: NavTab) => {
    setActiveTab(tab);
    onClose();
  };

  return (
    <div className="md:hidden fixed inset-0 z-50 flex flex-col justify-end bg-black/80 backdrop-blur-md animate-in fade-in duration-200 select-none">
      {/* Backdrop tap to close */}
      <div className="absolute inset-0" onClick={onClose} />

      {/* Drawer Surface */}
      <div
        className="relative z-10 w-full max-h-[85vh] flex flex-col rounded-t-3xl bg-[#0e0e12] border-t border-white/15 shadow-2xl overflow-hidden animate-in slide-in-from-bottom duration-300"
        style={{ paddingBottom: "calc(16px + env(safe-area-inset-bottom, 0px))" }}
      >
        {/* Drag handle & Header */}
        <div className="flex flex-col items-center pt-3 pb-2 px-6 border-b border-white/10 shrink-0">
          <div className="w-10 h-1.5 rounded-full bg-white/20 mb-3" />
          <div className="flex items-center justify-between w-full">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-amber-400 to-amber-600 text-black shadow-md">
                <Zap className="h-4 w-4 fill-black text-black" />
              </div>
              <div>
                <h3 className="font-bold text-sm text-white">Nebula Navigation</h3>
                <p className="text-[11px] text-zinc-400">WhatsApp Multi-Device Cloud Bot</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="rounded-full p-2 text-zinc-400 hover:bg-white/10 hover:text-white transition cursor-pointer"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Quick Actions Row */}
        <div className="px-4 py-3 border-b border-white/10 bg-white/[0.02] flex items-center justify-between gap-2 shrink-0">
          <button
            onClick={() => {
              onClose();
              onRunCheckup();
            }}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs font-semibold hover:bg-amber-500/20 transition cursor-pointer"
          >
            <Activity size={14} />
            <span>Checkup</span>
          </button>

          <button
            onClick={onResetSession}
            disabled={isResetting}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-white/5 border border-white/10 text-zinc-300 text-xs font-medium hover:bg-white/10 transition cursor-pointer disabled:opacity-50"
          >
            <RotateCcw size={14} className={isResetting ? "animate-spin" : ""} />
            <span>{isResetting ? "Resetting..." : "Reset"}</span>
          </button>

          {botStatus === "connected" ? (
            <button
              onClick={onToggleBot}
              disabled={isStarting}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-rose-500/20 border border-rose-500/30 text-rose-300 text-xs font-semibold hover:bg-rose-500/30 transition cursor-pointer"
            >
              <Power size={14} />
              <span>Stop Bot</span>
            </button>
          ) : (
            <button
              onClick={() => handleSelect("connect")}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-amber-500 text-black text-xs font-bold hover:bg-amber-400 transition cursor-pointer"
            >
              <Zap size={14} className="fill-black" />
              <span>Connect</span>
            </button>
          )}
        </div>

        {/* Scrollable Navigation Grid */}
        <div className="overflow-y-auto p-4 space-y-4 dark-scroll">
          {/* Main sections */}
          <div>
            <h4 className="text-[11px] font-bold uppercase tracking-wider text-zinc-500 px-2 mb-2">
              Management & Controls
            </h4>
            <div className="grid grid-cols-2 gap-2">
              {ITEMS.filter((i) => i.category === "manage" || i.category === "start").map((item) => {
                const isActive = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => handleSelect(item.id)}
                    className={`flex items-center gap-2.5 p-2.5 rounded-xl border text-left transition cursor-pointer active:scale-98 ${
                      isActive
                        ? "bg-amber-500/20 border-amber-500/40 text-amber-400 font-semibold"
                        : "bg-white/[0.03] border-white/10 text-zinc-300 hover:bg-white/[0.06] hover:text-white"
                    }`}
                  >
                    <span className={isActive ? "text-amber-400" : "text-zinc-400"}>{item.icon}</span>
                    <span className="text-xs truncate">{item.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <h4 className="text-[11px] font-bold uppercase tracking-wider text-zinc-500 px-2 mb-2">
              Administration
            </h4>
            <div className="grid grid-cols-2 gap-2">
              {ITEMS.filter((i) => i.category === "admin").map((item) => {
                const isActive = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => handleSelect(item.id)}
                    className={`flex items-center gap-2.5 p-2.5 rounded-xl border text-left transition cursor-pointer active:scale-98 ${
                      isActive
                        ? "bg-amber-500/20 border-amber-500/40 text-amber-400 font-semibold"
                        : "bg-white/[0.03] border-white/10 text-zinc-300 hover:bg-white/[0.06] hover:text-white"
                    }`}
                  >
                    <span className={isActive ? "text-amber-400" : "text-zinc-400"}>{item.icon}</span>
                    <span className="text-xs truncate">{item.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <h4 className="text-[11px] font-bold uppercase tracking-wider text-zinc-500 px-2 mb-2">
              Developer & Tools
            </h4>
            <div className="grid grid-cols-2 gap-2">
              {ITEMS.filter((i) => i.category === "dev").map((item) => {
                const isActive = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => handleSelect(item.id)}
                    className={`flex items-center gap-2.5 p-2.5 rounded-xl border text-left transition cursor-pointer active:scale-98 ${
                      isActive
                        ? "bg-amber-500/20 border-amber-500/40 text-amber-400 font-semibold"
                        : "bg-white/[0.03] border-white/10 text-zinc-300 hover:bg-white/[0.06] hover:text-white"
                    }`}
                  >
                    <span className={isActive ? "text-amber-400" : "text-zinc-400"}>{item.icon}</span>
                    <span className="text-xs truncate">{item.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
