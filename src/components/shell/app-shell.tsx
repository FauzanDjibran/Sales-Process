"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/icon";
import { Topbar, type ShellUser } from "@/components/shell/topbar";
import { type AppKey, type NavModule, resolvePath, entityHref } from "@/lib/erp/nav";

/**
 * `modules` arrives already filtered by the signed-in user's permissions (see
 * `visibleModules` in `lib/erp/nav.ts`). The shell renders what it is given
 * and decides nothing about access itself — the pages behind every link check
 * again on the server.
 */
export function AppShell({
  app,
  canSwitch,
  user,
  modules,
  children,
}: {
  /** Which application this shell is (P254): its mark and its profile route. */
  app: AppKey;
  /** The user holds both applications, so the topbar offers the picker. */
  canSwitch: boolean;
  user: ShellUser;
  modules: NavModule[];
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { module: activeModule, entity: activeEntity } = resolvePath(pathname);

  const [subOpen, setSubOpen] = useState(true);
  const narrow = useNarrow();
  const [navOpen, setNavOpen] = useState(false);
  // A rail press navigates to the module's first leaf and should leave the
  // drawer open on its submenu; every other navigation closes it.
  const [railTarget, setRailTarget] = useState<string | null>(null);
  const [seenPath, setSeenPath] = useState(pathname);
  if (seenPath !== pathname) {
    setSeenPath(pathname);
    if (railTarget === pathname) setRailTarget(null);
    else if (navOpen) setNavOpen(false);
  }

  // The submenu shows only the leaves this user may reach; a module whose
  // leaves are all hidden never reaches the rail in the first place.
  const visibleModule = modules.find((m) => m.key === activeModule?.key);
  const hasSub = Boolean(visibleModule?.groups?.length);


  // One rail item per module, in either application (convention §3.3).
  const railItems = modules.map((m) => ({
    key: m.key,
    name: m.name,
    icon: m.icon,
    href: m.groups ? firstLeafHref(modules, m.key) : `/${m.key}`,
    on: activeModule?.key === m.key,
    opensSub: Boolean(m.groups),
  }));
  const showSub = hasSub && subOpen;

  // Below 860px the rail and submenu are a drawer, driven by classes on
  // <body> that the stylesheet already carries.
  useEffect(() => {
    const on = narrow && navOpen;
    document.body.classList.toggle("nav-open", on);
    document.body.classList.toggle("no-sub", !hasSub);
    return () => {
      document.body.classList.remove("nav-open", "no-sub");
    };
  }, [narrow, navOpen, hasSub]);

  return (
    <div className="app">
      <Topbar app={app} canSwitch={canSwitch} user={user} navOpen={navOpen} onNav={() => setNavOpen((o) => !o)} />

      <div className="body">
        {/* A drawer that is off screen, or a submenu collapsed to nothing, must
            not keep its links in the tab order: Tab would land on controls
            nobody can see. */}
        <nav className="rail" inert={narrow && !navOpen}>
          <div className="rail-mid" style={{ paddingTop: 7 }}>
            {/* The rail is how a hidden submenu comes back. There is nowhere else
                to press: the collapse button leaves with the panel it sits in,
                and the floating reopen button that used to live in the content
                area sat underneath the sticky page header, where nobody could
                reach it. Pressing a module always *opens* its menu rather than
                toggling it, so one press never has two outcomes. */}
            {railItems.map((r) => (
              <Link
                key={r.key}
                href={r.href}
                className={`ri${r.on ? " on" : ""}`}
                onClick={() => {
                  setSubOpen(true);
                  if (narrow && r.opensSub) setRailTarget(r.href);
                }}
              >
                <Icon name={r.icon} size={18} />
                <span className="ri-tip">{r.name}</span>
              </Link>
            ))}
          </div>
        </nav>

        <nav
          className="sub"
          inert={narrow ? !navOpen || !hasSub : !showSub}
          style={
            showSub || narrow
              ? undefined
              : { width: 0, borderWidth: 0, opacity: 0, pointerEvents: "none" }
          }
        >
          <div className="sub-h">
            <div className="t">
              <h2>{activeModule?.name ?? ""}</h2>
              <p>{activeModule?.desc ?? ""}</p>
            </div>
            <button
              className="collapse"
              onClick={() => (narrow ? setNavOpen(false) : setSubOpen(false))}
              title="Sembunyikan menu"
            >
              <Icon name="back" size={13} />
            </button>
          </div>

          <div className="sub-l">
            {(visibleModule?.groups ?? []).map((g) => (
              <div className="grp" key={g.key}>
                <div className="grp-b on">
                  <span className="dot" />
                  <span className="gt">{g.name}</span>
                </div>
                <div className="grp-i">
                  {g.entities.map((e) => (
                    <Link
                      key={e.key}
                      href={entityHref(visibleModule!.key, e.slug)}
                      className={`leaf${activeEntity?.key === e.key ? " on" : ""}`}
                      onClick={() => setNavOpen(false)}
                    >
                      <span className="lt">{e.name}</span>
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </nav>

        <div className="scrim" onClick={() => setNavOpen(false)} />

        <main className="content">
          <div className="pad">{children}</div>
        </main>
      </div>
    </div>
  );
}

/** Whether the viewport is at the width where the navigation becomes a drawer. */
const NARROW = "(max-width: 860px)";
function useNarrow(): boolean {
  return useSyncExternalStore(
    (notify) => {
      const mq = window.matchMedia(NARROW);
      mq.addEventListener("change", notify);
      return () => mq.removeEventListener("change", notify);
    },
    () => window.matchMedia(NARROW).matches,
    () => false
  );
}

/** Rail links land on a module's first visible leaf, not a bare module URL. */
function firstLeafHref(modules: NavModule[], moduleKey: string): string {
  const mod = modules.find((m) => m.key === moduleKey);
  const first = mod?.groups?.[0]?.entities[0];
  return first ? entityHref(moduleKey, first.slug) : `/${moduleKey}`;
}
