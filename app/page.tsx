"use client";

import dynamic from "next/dynamic";

// three.js touches window APIs during import; keep the app client-only.
const RepairCADApp = dynamic(() => import("./RepairCADApp"), {
  ssr: false,
  loading: () => (
    <div className="flex min-h-screen justify-center px-6 pt-24">
      <h1>Loading…</h1>
    </div>
  ),
});

export default function Home() {
  return <RepairCADApp />;
}
