"use client";

import dynamic from "next/dynamic";

import { AppShell, Card } from "@/components/AppShell";

// three.js touches window APIs during import; keep the app client-only.
const RepairCADApp = dynamic(() => import("./RepairCADApp"), {
  ssr: false,
  loading: () => (
    <AppShell>
      <Card className="!pt-24">
        <h1>Loading…</h1>
      </Card>
    </AppShell>
  ),
});

export default function Home() {
  return <RepairCADApp />;
}
