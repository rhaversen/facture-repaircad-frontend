/*
  NEXT_PUBLIC_* vars are inlined by the compiler only when accessed as static
  members (process.env.NEXT_PUBLIC_X). A dynamic process.env[name] lookup is
  left untouched and would be empty in the browser, so the value — not the
  name — is passed in and checked.
*/
function requireEnv(value: string | undefined, name: string): string {
  if (value === undefined || value === "") {
    throw new Error(
      `Missing required env var ${name}. ` +
        "next dev needs .env.development, next build needs .env.production.",
    );
  }
  return value;
}

export const FLOW_API_BASE = requireEnv(
  process.env.NEXT_PUBLIC_FLOW_API_BASE,
  "NEXT_PUBLIC_FLOW_API_BASE",
);
export const FLOW_EMBED_BASE = requireEnv(
  process.env.NEXT_PUBLIC_FLOW_EMBED_BASE,
  "NEXT_PUBLIC_FLOW_EMBED_BASE",
);
export const FORGE_BASE = requireEnv(
  process.env.NEXT_PUBLIC_FORGE_BASE,
  "NEXT_PUBLIC_FORGE_BASE",
);
export const AUTH_BASE = requireEnv(
  process.env.NEXT_PUBLIC_AUTH_BASE,
  "NEXT_PUBLIC_AUTH_BASE",
);
