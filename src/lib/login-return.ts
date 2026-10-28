// Only explicitly supported internal destinations survive authentication.
export function doctorReturn(params: { patient?: unknown; event?: unknown }) {
  const query = new URLSearchParams();
  for (const key of ["patient", "event"] as const) { const value = params[key]; if (typeof value === "string" && /^[a-z0-9-]{1,100}$/i.test(value)) query.set(key, value); }
  return `/doctor${query.size ? `?${query}` : ""}`;
}
export function patientReturn(params: { assignment?: unknown }) {
  return typeof params.assignment === "string" && /^[a-z0-9-]{1,100}$/i.test(params.assignment) ? `/patient?assignment=${encodeURIComponent(params.assignment)}` : "/patient";
}
export function loginReturn(value: string | null) {
  // The code screen is an entry point, not a destination after sign-in. Routing
  // through "/" sends linked patients to the cabinet and unlinked ones back here.
  if (value === "/connect") return "/";
  if (!value || !/^\/(doctor|patient)(?:\?|$)/.test(value)) return "/";
  try { const url = new URL(value, "https://kontur.invalid"); if (url.origin !== "https://kontur.invalid") return "/"; if (url.pathname === "/patient") return patientReturn(Object.fromEntries(url.searchParams)); if (url.pathname !== "/doctor") return "/"; return doctorReturn(Object.fromEntries(url.searchParams)); } catch { return "/"; }
}
