import {
  Home,
  QrCode,
  Terminal,
  Cpu,
  Package,
  Users,
  ShieldAlert,
  BarChart2,
  Settings,
  KeyRound,
  FileText,
  BookOpen,
  FileDown,
  PanelLeftClose,
  PanelLeft,
  Sparkles,
  Zap,
} from "lucide-react";
import { ConnectionStatus } from "../lib/types";

export type NavTab =
  | "overview"
  | "connect"
  | "commands"
  | "simulator"
  | "gemini"
  | "plugins"
  | "groups"
  | "security"
  | "analytics"
  | "secrets"
  | "logs"
  | "settings"
  | "docs"
  | "export";

interface SidebarProps {
  activeTab: NavTab;
  setActiveTab: (tab: NavTab) => void;
  collapsed: boolean;
  setCollapsed: (collapsed: boolean | ((prev: boolean) => boolean)) => void;
  botStatus: ConnectionStatus | "pair_code";
  reconnectCount: number;
}

interface NavItemProps {
  icon: React.ReactNode;
  label: string;
  badge?: string | number;
  active?: boolean;
  collapsed?: boolean;
  onClick: () => void;
}

function NavItem({ icon, label, badge, active, collapsed, onClick }: NavItemProps) {
  return (
    <button
      onClick={onClick}
      title={collapsed ? label : undefined}
      className={`group relative flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-all cursor-pointer ${
        active
          ? "bg-white/10 text-amber-400 shadow-sm"
          : "text-zinc-400 hover:bg-white/5 hover:text-zinc-100"
      } ${collapsed ? "justify-center px-2" : ""}`}
    >
      <span className={`h-4 w-4 shrink-0 transition-colors ${active ? "text-amber-400" : "text-zinc-400 group-hover:text-zinc-200"}`}>
        {icon}
      </span>
      {!collapsed && (
        <>
          <span className="truncate">{label}</span>
          {badge !== undefined && (
            <span className="ml-auto rounded-full bg-white/10 px-1.5 py-0.5 text-[10px] font-mono text-zinc-300">
              {badge}
            </span>
          )}
        </>
      )}
    </button>
  );
}

function SectionLabel({ children, collapsed }: { children: React.ReactNode; collapsed?: boolean }) {
  if (collapsed) {
    return <div className="my-2 border-t border-white/5" />;
  }
  return (
    <p className="px-3 pb-1.5 pt-4 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
      {children}
    </p>
  );
}

export default function Sidebar({
  activeTab,
  setActiveTab,
  collapsed,
  setCollapsed,
  botStatus,
  reconnectCount,
}: SidebarProps) {
  return (
    <aside
      className={`hidden md:flex h-full shrink-0 flex-col justify-between border-r border-white/10 bg-black transition-all duration-200 ${
        collapsed ? "w-16" : "w-64"
      }`}
    >
      {/* Top Header / Branding */}
      <div className="flex h-14 items-center justify-between border-b border-white/10 px-4">
        {!collapsed ? (
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-amber-400 to-amber-600 text-black font-black text-sm shadow-md">
              <Zap className="h-4 w-4 fill-black text-black" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="font-bold text-sm text-white tracking-tight">Nebula</span>
                <span className="rounded-md bg-amber-500/20 px-1.5 py-0.2 text-[10px] font-mono font-semibold text-amber-400">v1.1</span>
              </div>
              <p className="text-[10px] text-zinc-500 truncate">WhatsApp Cloud Bot</p>
            </div>
          </div>
        ) : (
          <div className="mx-auto flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-amber-400 to-amber-600 text-black font-black text-sm shadow-md">
            <Zap className="h-4 w-4 fill-black text-black" />
          </div>
        )}
      </div>

      {/* Navigation List */}
      <div className="flex flex-1 flex-col overflow-y-auto px-2.5 py-2 dark-scroll">
        <div>
          <SectionLabel collapsed={collapsed}>Getting Started</SectionLabel>
          <div className="space-y-0.5">
            <NavItem
              icon={<Home size={16} />}
              label="Overview"
              active={activeTab === "overview"}
              collapsed={collapsed}
              onClick={() => setActiveTab("overview")}
            />
            <NavItem
              icon={<QrCode size={16} />}
              label="WhatsApp Connect"
              active={activeTab === "connect"}
              collapsed={collapsed}
              badge={botStatus === "connected" ? "Live" : undefined}
              onClick={() => setActiveTab("connect")}
            />
            <NavItem
              icon={<Terminal size={16} />}
              label="Simulator"
              active={activeTab === "simulator"}
              collapsed={collapsed}
              onClick={() => setActiveTab("simulator")}
            />
          </div>
        </div>

        <div>
          <SectionLabel collapsed={collapsed}>Manage</SectionLabel>
          <div className="space-y-0.5">
            <NavItem
              icon={<Cpu size={16} />}
              label="Commands"
              active={activeTab === "commands"}
              collapsed={collapsed}
              onClick={() => setActiveTab("commands")}
            />
            <NavItem
              icon={<Sparkles size={16} />}
              label="Gemini AI"
              active={activeTab === "gemini"}
              collapsed={collapsed}
              onClick={() => setActiveTab("gemini")}
            />
            <NavItem
              icon={<Package size={16} />}
              label="Plugins"
              active={activeTab === "plugins"}
              collapsed={collapsed}
              onClick={() => setActiveTab("plugins")}
            />
          </div>
        </div>

        <div>
          <SectionLabel collapsed={collapsed}>Admin</SectionLabel>
          <div className="space-y-0.5">
            <NavItem
              icon={<Users size={16} />}
              label="Group Tools"
              active={activeTab === "groups"}
              collapsed={collapsed}
              onClick={() => setActiveTab("groups")}
            />
            <NavItem
              icon={<ShieldAlert size={16} />}
              label="Security & Antilink"
              active={activeTab === "security"}
              collapsed={collapsed}
              onClick={() => setActiveTab("security")}
            />
            <NavItem
              icon={<BarChart2 size={16} />}
              label="Analytics & AI"
              active={activeTab === "analytics"}
              collapsed={collapsed}
              onClick={() => setActiveTab("analytics")}
            />
            <NavItem
              icon={<Settings size={16} />}
              label="Settings"
              active={activeTab === "settings"}
              collapsed={collapsed}
              onClick={() => setActiveTab("settings")}
            />
          </div>
        </div>

        <div>
          <SectionLabel collapsed={collapsed}>Developer</SectionLabel>
          <div className="space-y-0.5">
            <NavItem
              icon={<KeyRound size={16} />}
              label="API Secrets"
              active={activeTab === "secrets"}
              collapsed={collapsed}
              onClick={() => setActiveTab("secrets")}
            />
            <NavItem
              icon={<FileText size={16} />}
              label="Console Logs"
              active={activeTab === "logs"}
              collapsed={collapsed}
              onClick={() => setActiveTab("logs")}
            />
            <NavItem
              icon={<BookOpen size={16} />}
              label="Documentation"
              active={activeTab === "docs"}
              collapsed={collapsed}
              onClick={() => setActiveTab("docs")}
            />
            <NavItem
              icon={<FileDown size={16} />}
              label="Export"
              active={activeTab === "export"}
              collapsed={collapsed}
              onClick={() => setActiveTab("export")}
            />
          </div>
        </div>
      </div>

      {/* Footer / Status & Collapse Toggle */}
      <div className="border-t border-white/10 px-3 py-3 space-y-2">
        {!collapsed && (
          <div className="flex items-center justify-between rounded-xl bg-[#0b0b0c] border border-white/10 px-3 py-2">
            <div className="flex items-center gap-2">
              <span
                className={`h-2.5 w-2.5 rounded-full ${
                  botStatus === "connected"
                    ? "bg-emerald-400 ring-4 ring-emerald-400/20 animate-pulse"
                    : botStatus === "connecting"
                    ? "bg-amber-400 ring-4 ring-amber-400/20 animate-pulse"
                    : botStatus === "qr_ready" || botStatus === "pair_code"
                    ? "bg-amber-400 ring-4 ring-amber-400/20 animate-pulse"
                    : "bg-rose-500"
                }`}
              />
              <span className="text-xs font-semibold text-zinc-300 capitalize truncate">
                {botStatus === "qr_ready"
                  ? "Scan QR"
                  : botStatus === "pair_code"
                  ? "Pair Code"
                  : botStatus}
              </span>
            </div>
            {reconnectCount > 0 && (
              <span className="text-[10px] font-mono text-zinc-500">
                Retry #{reconnectCount}
              </span>
            )}
          </div>
        )}

        <button
          onClick={() => setCollapsed((prev) => !prev)}
          className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm text-zinc-400 hover:bg-white/5 hover:text-zinc-100 transition-colors cursor-pointer ${
            collapsed ? "justify-center px-0" : ""
          }`}
          title={collapsed ? "Expand Sidebar" : "Collapse Sidebar"}
        >
          {collapsed ? <PanelLeft size={16} /> : <PanelLeftClose size={16} />}
          {!collapsed && <span>Collapse Sidebar</span>}
        </button>
      </div>
    </aside>
  );
}
