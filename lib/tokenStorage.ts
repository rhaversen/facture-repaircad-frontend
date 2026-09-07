import { TOKEN_STORAGE_KEY } from "./pipeline";

/*
  RepairCAD is a third-party Flow client, so the session cookie is not
  enough — the user pastes a Facture personal access token which is kept in
  localStorage and sent as a Bearer header on every Flow/Forge request.

  localStorage cannot be subscribed to, so token writes dispatch a window
  event that lets React (useSyncExternalStore) re-read it without an
  effect-driven cascading render.
*/
const TOKEN_EVENT = "repaircad.token-changed";

function subscribeToTokenStorage(onChange: () => void) {
  window.addEventListener(TOKEN_EVENT, onChange);
  // Token edits in another tab also matter.
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(TOKEN_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

function notifyTokenChanged() {
  window.dispatchEvent(new Event(TOKEN_EVENT));
}

export function readAccessToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function saveAccessToken(token: string) {
  try {
    window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
  } catch {
    // Private mode etc. — the in-memory token still works for this session.
  }
  notifyTokenChanged();
}

export function clearAccessToken() {
  try {
    window.localStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    // Ignore storage failures.
  }
  notifyTokenChanged();
}

export { subscribeToTokenStorage, TOKEN_EVENT };

