import type { ReactNode } from "react";

export function AppShell({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`app-shell min-h-screen px-5 py-12 ${className}`.trim()}>{children}</div>;
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <main
      className={`repair-card relative mx-auto w-full max-w-[760px] rounded-2xl border border-line bg-white px-12 pb-12 pt-24 max-[640px]:px-5 max-[640px]:pb-7 ${className}`.trim()}
    >
      {children}
    </main>
  );
}

export function AppHeader({
  utilities,
}: {
  utilities?: ReactNode;
}) {
  return (
    <div className="app-header-row absolute inset-x-5 top-4 z-10 flex flex-wrap items-start justify-between gap-5">
      <div className="brand text-lg font-bold">RepairCAD</div>
      {utilities ? <div className="flex items-center gap-1.5">{utilities}</div> : null}
    </div>
  );
}
