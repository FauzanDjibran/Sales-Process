"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Topbar, type ShellUser } from "@/components/shell/topbar";

/** The topbar over the viewer. Below 860px the table list is a drawer the burger opens. */
export function DatabaseShell({ canSwitch, user, children }: { canSwitch: boolean; user: ShellUser; children: React.ReactNode }) {
  const [navOpen, setNavOpen] = useState(false);
  // Choosing a table changes the URL and closes the drawer.
  const query = useSearchParams().toString();
  const [seen, setSeen] = useState(query);
  if (seen !== query) {
    setSeen(query);
    setNavOpen(false);
  }
  useEffect(() => {
    document.body.classList.toggle("nav-open", navOpen);
    return () => document.body.classList.remove("nav-open");
  }, [navOpen]);

  return (
    <div className="app">
      <Topbar app="database" canSwitch={canSwitch} user={user} navOpen={navOpen} onNav={() => setNavOpen((o) => !o)} />
      <div className="body dbx">
        {children}
        <div className="scrim" onClick={() => setNavOpen(false)} />
      </div>
    </div>
  );
}
