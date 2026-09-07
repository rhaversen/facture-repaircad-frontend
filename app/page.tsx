"use client";

import dynamic from "next/dynamic";

// three.js touches window APIs during import; keep the app client-only.
const RepairCADApp = dynamic(() => import("./RepairCADApp"), {
  ssr: false,
  loading: () => (
    <div className="min-h-screen px-5 py-12">
      <main className="relative mx-auto w-full max-w-[760px] rounded-2xl border border-line bg-white px-12 pb-12 pt-24">
        <div className="text-lg font-bold">RepairCAD</div>
        <h1>Loading…</h1>
      </main>
    </div>
  ),
});

export default function Home() {
  return <RepairCADApp />;
}
