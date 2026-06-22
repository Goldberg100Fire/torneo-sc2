/**
 * Torneos por usuario: el documento `principal` sigue siendo el torneo en producción.
 */

export const LEGACY_TOURNAMENT_ID = "principal";
export const USER_TOURNAMENT_PREFIX = "ut_";

export function isLegacyPrincipal(tournamentId) {
  const id = String(tournamentId || "").trim();
  return !id || id === LEGACY_TOURNAMENT_ID;
}

export function isUserTournamentId(tournamentId) {
  return String(tournamentId || "").startsWith(USER_TOURNAMENT_PREFIX);
}

export function generateUserTournamentId() {
  return (
    USER_TOURNAMENT_PREFIX +
    Date.now().toString(36) +
    "_" +
    Math.random().toString(36).slice(2, 8)
  );
}

export function resolveTournamentIdFromSearch(search = "") {
  try {
    const params = new URLSearchParams(search);
    const t = params.get("t");
    if (t && t.trim()) return t.trim();
  } catch (e) {
    /* ignore */
  }
  return LEGACY_TOURNAMENT_ID;
}

export function storageKeyForTournament(tournamentId) {
  if (isLegacyPrincipal(tournamentId)) return "sc2-tournament-v2";
  return `sc2-tournament-v2:${tournamentId}`;
}

export function apiPathForTournament(tournamentId) {
  if (isLegacyPrincipal(tournamentId)) return "/api/tournament";
  return `/api/tournaments/${encodeURIComponent(tournamentId)}`;
}

export function publicViewUrl(tournamentId, base = "index.html") {
  if (isLegacyPrincipal(tournamentId)) return base;
  return `${base}?t=${encodeURIComponent(tournamentId)}`;
}

export function adminViewUrl(tournamentId, base = "admin.html") {
  if (isLegacyPrincipal(tournamentId)) return base;
  return `${base}?t=${encodeURIComponent(tournamentId)}`;
}

export function emptyTournamentPayload() {
  return {
    teams: [],
    bracket: null,
    preliminary: null,
    drawInfo: null,
    drawn: false,
    roundFormats: null,
    teamIdCounter: 1,
    savedAt: new Date().toISOString(),
  };
}
