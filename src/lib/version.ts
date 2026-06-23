/** Build identity, injected via next.config env at build time. */
export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0";
export const GIT_SHA = process.env.NEXT_PUBLIC_GIT_SHA ?? "";
export const BUILD_DATE = process.env.NEXT_PUBLIC_BUILD_DATE ?? "";

/** Short label, e.g. "v0.1.0 · a1b2c3d" (sha omitted when unavailable). */
export const VERSION_LABEL = `v${APP_VERSION}${GIT_SHA ? ` · ${GIT_SHA}` : ""}`;
