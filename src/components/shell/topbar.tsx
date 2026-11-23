"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/icon";
import { logout } from "@/app/actions/auth";
import { APPS, type AppKey } from "@/lib/erp/nav";

export type ShellUser = {
  name: string;
  initials: string;
  email: string;
  roles: string[];
};

/** Profil Saya inside the application the user is in (P254). */
const PROFILE: Record<AppKey, string> = {
  erp: "/settings/profile",
  production: "/production/profile",
  database: "/database/profile",
};

/** The topbar every application shares: burger, brand, Pilih aplikasi, account. */
export function Topbar({
  app,
  canSwitch,
  user,
  navOpen,
  onNav,
}: {
  app: AppKey;
  /** The user holds another application, so the topbar offers the picker. */
  canSwitch: boolean;
  user: ShellUser;
  navOpen: boolean;
  onNav: () => void;
}) {
  const [userOpen, setUserOpen] = useState(false);
  const userRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!userOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!userRef.current?.contains(e.target as Node)) setUserOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setUserOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [userOpen]);

  return (
    <header className="topbar">
      <button
        className="tb-burger"
        onClick={onNav}
        aria-label={navOpen ? "Tutup menu" : "Buka menu"}
        aria-expanded={navOpen}
      >
        <Icon name="menu" size={17} />
      </button>
      <div className="brand">
        <div className="brand-mark">{APPS[app].mark}</div>
        <div className="brand-txt">{APPS[app].name}</div>
        <span className="brand-ver">0.1</span>
      </div>
      {canSwitch && (
        <Link className="ticon" href="/apps" title="Pilih aplikasi" aria-label="Pilih aplikasi">
          <Icon name="grid" size={15} />
        </Link>
      )}

      <div className="tb-spacer" />

      <div className="uchip-wrap" ref={userRef}>
        <button
          className="uchip"
          onClick={() => setUserOpen((o) => !o)}
          title="Akun saya"
          aria-haspopup="menu"
          aria-expanded={userOpen}
        >
          <div className="avatar">{user.initials}</div>
          <b>{user.name}</b>
          <Icon name="down" size={12} />
        </button>

        {userOpen && (
          <div className="umenu" role="menu">
            <div className="umenu-h">
              <b>{user.name}</b>
              <span>{user.email}</span>
              <span className="umenu-roles">
                {user.roles.length ? (
                  user.roles.map((r) => (
                    <span className="bdg t-slate" key={r}>
                      {r}
                    </span>
                  ))
                ) : (
                  <span className="bdg s-mute">Tanpa Role</span>
                )}
              </span>
            </div>
            <Link
              className="umenu-i"
              href={PROFILE[app]}
              onClick={() => setUserOpen(false)}
              role="menuitem"
            >
              <Icon name="user" size={14} /> Profil Saya
            </Link>
            <form action={logout}>
              <button className="umenu-i danger" type="submit" role="menuitem">
                <Icon name="out" size={14} /> Keluar
              </button>
            </form>
          </div>
        )}
      </div>
    </header>
  );
}
