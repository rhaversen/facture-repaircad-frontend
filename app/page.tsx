"use client";

import dynamic from "next/dynamic";

import { Loading } from "@/components/ui";

// three.js touches window APIs during import; keep the app client-only.
const RepairCADApp = dynamic(() => import("./RepairCADApp"), {
  ssr: false,
  loading: () => <Loading className="min-h-dvh" />,
});

export default function Home() {
  return <RepairCADApp />;
}
