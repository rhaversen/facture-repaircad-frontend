"use client";

import { useAccount } from "./Account";
import { ChevronDownIcon } from "./icons";
import { buttonClass, cn } from "./ui";
import { authUrl } from "@/lib/auth";

function AccountMenu() {
  const { user, onLogout } = useAccount();
  if (!user) {
    return (
      <a href={authUrl()} className={buttonClass("secondary")}>
        Log in
      </a>
    );
  }
  return (
    <div className="group relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-label={`Account: ${user.displayName}`}
        className="flex h-9 cursor-pointer items-center gap-2 rounded-full border border-border bg-surface pr-3 pl-1 text-sm text-muted transition-colors hover:border-border-strong hover:text-foreground"
      >
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent text-xs font-semibold text-accent-contrast uppercase">
          {user.displayName.slice(0, 1)}
        </span>
        <span className="hidden max-w-32 truncate font-medium sm:block">{user.displayName}</span>
        <ChevronDownIcon size={14} />
      </button>
      {/* the padding bridges the gap, so the menu stays open on the way down */}
      <div className="invisible absolute top-full right-0 z-50 translate-y-1 pt-2 opacity-0 transition-all duration-150 ease-out group-focus-within:visible group-focus-within:translate-y-0 group-focus-within:opacity-100 group-hover:visible group-hover:translate-y-0 group-hover:opacity-100">
        <div className="w-60 rounded-2xl border border-border bg-surface p-2 shadow-xl">
          <div className="px-3 py-2">
            <p className="truncate text-sm font-medium">{user.displayName}</p>
            {user.email && <p className="truncate text-xs text-muted">{user.email}</p>}
          </div>
          <button
            type="button"
            onClick={onLogout}
            className="w-full cursor-pointer rounded-xl px-3 py-2 text-left text-sm text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
          >
            Log out
          </button>
        </div>
      </div>
    </div>
  );
}

const tabClass = (active: boolean) =>
  cn(
    "rounded-full px-3 py-1.5 text-sm transition-colors",
    active ? "bg-surface-2 font-medium text-foreground" : "cursor-pointer text-muted hover:text-foreground",
  );

/*
  The menu bar: the app's favicon and name, the tabs, and the account pill.
  On the run list "Repairs" is the current tab; inside a repair it is the way
  back to the list, beside the open "Repair".
*/
export default function Navbar({ home = false, onAllRuns }: { home?: boolean; onAllRuns?: () => void }) {
  const brand = (
    <>
      {/* the app's own favicon (app/icon.svg) */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/icon.svg" alt="" width={28} height={28} className="h-7 w-7" />
      Repair CAD
    </>
  );
  return (
    <header className="shrink-0 border-b border-border/60 bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4 sm:px-6">
        {onAllRuns ? (
          <button
            type="button"
            onClick={onAllRuns}
            className="flex shrink-0 cursor-pointer items-center gap-2 font-semibold tracking-tight"
          >
            {brand}
          </button>
        ) : (
          <span className="flex shrink-0 items-center gap-2 font-semibold tracking-tight">{brand}</span>
        )}
        {(home || onAllRuns) && (
          <nav className="flex items-center gap-1">
            {home ? (
              <span aria-current="page" className={tabClass(true)}>
                Repairs
              </span>
            ) : (
              <>
                <button type="button" title="Show all repairs" className={tabClass(false)} onClick={onAllRuns}>
                  Repairs
                </button>
                <span aria-current="page" className={cn(tabClass(true), "max-[420px]:hidden")}>
                  Repair
                </span>
              </>
            )}
          </nav>
        )}
        <div className="ml-auto">
          <AccountMenu />
        </div>
      </div>
    </header>
  );
}
