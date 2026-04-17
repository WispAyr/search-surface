"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { LogOut, Settings, User, ChevronDown } from "lucide-react";

export function UserMenu() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  if (!user) return null;

  const initial = (user.display_name || user.email || "?").trim().charAt(0).toUpperCase();

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 px-2 py-1 rounded hover:bg-surface-700 transition text-sm"
      >
        <div className="w-6 h-6 rounded-full bg-accent text-black text-xs font-medium flex items-center justify-center">
          {initial}
        </div>
        <span className="hidden sm:block text-fg-2">{user.tenant.name}</span>
        <ChevronDown size={12} className="text-fg-4" />
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-56 bg-surface-800 border border-surface-600 rounded-lg shadow-xl z-[2000] text-sm">
          <div className="px-3 py-2 border-b border-surface-700">
            <div className="text-fg-1 truncate">{user.display_name || user.email}</div>
            <div className="text-xs text-fg-4 truncate">{user.email}</div>
            <div className="text-[10px] uppercase tracking-wider text-fg-4 mt-1">
              {user.tenant.name} · {user.role}
            </div>
          </div>
          <Link
            href="/settings"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-3 py-2 hover:bg-surface-700 text-fg-2 hover:text-fg-1"
          >
            <Settings size={14} />
            Team settings
          </Link>
          {user.role === "owner" && (
            <Link
              href="/settings/members"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 px-3 py-2 hover:bg-surface-700 text-fg-2 hover:text-fg-1"
            >
              <User size={14} />
              Members
            </Link>
          )}
          <button
            onClick={async () => {
              await logout();
              setOpen(false);
              router.replace("/");
            }}
            className="w-full flex items-center gap-2 px-3 py-2 hover:bg-surface-700 text-fg-2 hover:text-fg-1 border-t border-surface-700"
          >
            <LogOut size={14} />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
