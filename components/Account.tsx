"use client";

import { createContext, useContext } from "react";

import type { FactureUser } from "@/lib/auth";

/** Who is signed in (null until known, or when no one is) and how to log out; shown by the menu bar. */
export interface Account {
  user: FactureUser | null;
  onLogout: () => void;
}

export const AccountContext = createContext<Account>({ user: null, onLogout: () => {} });

export const useAccount = () => useContext(AccountContext);
