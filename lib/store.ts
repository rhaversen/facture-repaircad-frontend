/*
  Everything the app remembers across a refresh: which repair run is open, and
  the Forge designs generated for each run (in handoff order). Every other
  state is either on the servers or a few clicks away.
*/
const ACTIVE_RUN_KEY = "repaircad.activeRun";
const DESIGNS_KEY = "repaircad.designs";

function read<T>(key: string, valid: (value: unknown) => value is T): T | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? "null");
    return valid(value) ? value : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or blocked: only resuming after a refresh is lost.
  }
}

const isString = (value: unknown): value is string => typeof value === "string";

const isDesignMap = (value: unknown): value is Record<string, string[]> =>
  typeof value === "object" &&
  value !== null &&
  Object.values(value).every((ids) => Array.isArray(ids) && ids.every(isString));

export const loadActiveRun = () => read(ACTIVE_RUN_KEY, isString);

export const storeActiveRun = (runId: string | null) => write(ACTIVE_RUN_KEY, runId);

export const loadDesigns = (runId: string): string[] =>
  read(DESIGNS_KEY, isDesignMap)?.[runId] ?? [];

/** Drops everything remembered about a run that no longer exists. */
export function forgetRun(runId: string) {
  if (loadActiveRun() === runId) storeActiveRun(null);
  const designs = { ...read(DESIGNS_KEY, isDesignMap) };
  delete designs[runId];
  write(DESIGNS_KEY, designs);
}

export function storeDesigns(runId: string, designIds: string[]) {
  write(DESIGNS_KEY, { ...read(DESIGNS_KEY, isDesignMap), [runId]: designIds });
}
