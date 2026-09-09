import { AUTH_BASE, FLOW_API_BASE } from "./env";

/** URL of the central auth page that returns the user to this app afterwards. */
export function authUrl(): string {
  const redirect = typeof window !== "undefined" ? window.location.origin : "";
  return `${AUTH_BASE}/?redirect=${encodeURIComponent(redirect)}`;
}

export interface FactureUser {
  id: string;
  displayName: string;
}

/** Confirm the shared Facture session cookie is still valid; null if not. */
export async function getMe(): Promise<FactureUser | null> {
  try {
    const res = await fetch(`${FLOW_API_BASE}/auth/me`, {
      credentials: "include",
    });
    if (!res.ok) return null;
    const body = await res.json();
    return body.user ?? null;
  } catch {
    return null;
  }
}

/** End the shared Facture session via Flow's logout proxy. */
export async function logout(): Promise<void> {
  try {
    await fetch(`${FLOW_API_BASE}/auth/logout`, {
      method: "POST",
      credentials: "include",
    });
  } catch {
    // The redirect to auth still happens; a stale cookie is tolerable.
  }
}


