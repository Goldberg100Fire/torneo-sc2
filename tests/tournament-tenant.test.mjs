import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  LEGACY_TOURNAMENT_ID,
  isLegacyPrincipal,
  isUserTournamentId,
  generateUserTournamentId,
  resolveTournamentIdFromSearch,
  storageKeyForTournament,
  apiPathForTournament,
  publicViewUrl,
  emptyTournamentPayload,
} from "../tournament-tenant.mjs";

describe("tournament-tenant", () => {
  it("principal es torneo legado", () => {
    assert.equal(isLegacyPrincipal("principal"), true);
    assert.equal(isLegacyPrincipal(""), true);
    assert.equal(isLegacyPrincipal(null), true);
    assert.equal(isLegacyPrincipal("ut_abc"), false);
  });

  it("detecta IDs de usuario", () => {
    assert.equal(isUserTournamentId("ut_1"), true);
    assert.equal(isUserTournamentId("principal"), false);
  });

  it("genera IDs ut_* únicos", () => {
    const a = generateUserTournamentId();
    const b = generateUserTournamentId();
    assert.match(a, /^ut_/);
    assert.notEqual(a, b);
  });

  it("resuelve ?t= desde la URL", () => {
    assert.equal(resolveTournamentIdFromSearch(""), LEGACY_TOURNAMENT_ID);
    assert.equal(resolveTournamentIdFromSearch("?t=ut_demo"), "ut_demo");
    assert.equal(resolveTournamentIdFromSearch("?foo=1"), LEGACY_TOURNAMENT_ID);
  });

  it("storage y API separados por torneo", () => {
    assert.equal(storageKeyForTournament("principal"), "sc2-tournament-v2");
    assert.equal(storageKeyForTournament("ut_x"), "sc2-tournament-v2:ut_x");
    assert.equal(apiPathForTournament("principal"), "/api/tournament");
    assert.equal(apiPathForTournament("ut_x"), "/api/tournaments/ut_x");
  });

  it("URL pública con parámetro t", () => {
    assert.equal(publicViewUrl("principal"), "index.html");
    assert.equal(publicViewUrl("ut_abc"), "index.html?t=ut_abc");
  });

  it("payload vacío tiene forma esperada", () => {
    const p = emptyTournamentPayload();
    assert.equal(p.drawn, false);
    assert.equal(p.bracket, null);
    assert.ok(Array.isArray(p.teams));
  });
});
