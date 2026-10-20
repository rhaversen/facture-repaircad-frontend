/*
  Everything the app remembers across a refresh: which repair run is open,
  the Forge designs generated for each run (in handoff order), and each
  design's AfterForge run. Every other state is either on the servers or a
  few clicks away.
*/
const ACTIVE_RUN_KEY = "repaircad.activeRun";
const DESIGNS_KEY = "repaircad.designs";
const REFINEMENTS_KEY = "repaircad.refinements";

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

const isRefinementMap = (value: unknown): value is Record<string, string> =>
  typeof value === "object" && value !== null && Object.values(value).every(isString);

export const loadActiveRun = () => read(ACTIVE_RUN_KEY, isString);

export const storeActiveRun = (runId: string | null) => write(ACTIVE_RUN_KEY, runId);

export const loadDesigns = (runId: string): string[] =>
  read(DESIGNS_KEY, isDesignMap)?.[runId] ?? [];

/** Drops everything remembered about a run that no longer exists. */
export function forgetRun(runId: string) {
  if (loadActiveRun() === runId) storeActiveRun(null);
  const designs = { ...read(DESIGNS_KEY, isDesignMap) };
  const refinements = { ...read(REFINEMENTS_KEY, isRefinementMap) };
  for (const designId of designs[runId] ?? []) delete refinements[designId];
  delete designs[runId];
  write(DESIGNS_KEY, designs);
  write(REFINEMENTS_KEY, refinements);
}

export function storeDesigns(runId: string, designIds: string[]) {
  write(DESIGNS_KEY, { ...read(DESIGNS_KEY, isDesignMap), [runId]: designIds });
}

export const loadRefinement = (designId: string): string | null =>
  read(REFINEMENTS_KEY, isRefinementMap)?.[designId] ?? null;

/** Remembers the AfterForge run of a design, or forgets it with `null`. */
export function storeRefinement(designId: string, runId: string | null) {
  const refinements = { ...read(REFINEMENTS_KEY, isRefinementMap) };
  if (runId === null) delete refinements[designId];
  else refinements[designId] = runId;
  write(REFINEMENTS_KEY, refinements);
}
