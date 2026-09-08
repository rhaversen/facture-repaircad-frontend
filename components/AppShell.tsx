import type { ReactNode } from "react";

/*
  Fill shells cap the shell at the viewport height and stretch the card to
  it, so bounded content can lay out against a definite height instead of
  collapsing or overflowing. Non-fill shells are plain scrolling pages.
*/
export function AppShell({
  children,
  className = "",
  fill = false,
}: {
  children: ReactNode;
  className?: string;
  fill?: boolean;
}) {
  return (
    <div
      className={`${fill ? "lg:flex lg:h-dvh lg:flex-col lg:overflow-hidden" : "min-h-screen"} ${fill ? "px-5 py-6" : "px-5 py-12"} ${className}`.trim()}
    >
      {children}
    </div>
  );
}

export function Card({
  children,
  className = "",
  fill = false,
}: {
  children: ReactNode;
  className?: string;
  fill?: boolean;
}) {
  return (
    <main
      className={`relative mx-auto w-full max-w-[760px] rounded-2xl border border-line bg-white px-12 pb-12 pt-5 max-[640px]:px-5 max-[640px]:pb-7 ${
        fill ? "lg:flex lg:min-h-0 lg:flex-1 lg:flex-col lg:overflow-y-auto" : ""
      } ${className}`.trim()}
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
    /*
      In-flow at the top of the card: the header scrolls away naturally with
      the page, exactly like the rest of the content.
    */
    <div className="mb-11 flex flex-wrap items-center justify-between gap-5 py-3 max-[640px]:mb-8">
      <div className="text-lg font-bold">RepairCAD</div>
      {utilities ? <div className="flex items-center gap-1.5">{utilities}</div> : null}
    </div>
  );
}
