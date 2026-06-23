import { test } from "node:test";
import assert from "node:assert/strict";
import { createTournamentLib } from "../tournament-lib.mjs";

const lib = createTournamentLib({ maxPlayersPerTeam: 6 });
const {
  hasBracketData,
  payloadScore,
  mergePayload,
  resolveAuthoritativePayload,
  resolvePublicPayload,
  shouldApplyRemotePayload,
  isIncomingStaleWrite,
  rosterSignature,
  feedBlocksSide,
} = lib;

function basePayload(overrides = {}) {
  return {
    drawn: true,
    teams: [{ id: "t1", name: "A", players: ["p1"] }],
    bracket: { wb: [[{ id: "m1", confirmed: false }]], lb: [], matches: [] },
    drawInfo: { drawnAt: "2026-01-01T12:00:00.000Z" },
    savedAt: "2026-01-01T12:00:00.000Z",
    ...overrides,
  };
}

test("hasBracketData lists legacy brackets without explicit drawn flag", () => {
  assert.equal(hasBracketData({ bracket: { wb: [[]] } }), true);
  assert.equal(hasBracketData({ drawn: false, bracket: { wb: [[]] } }), true);
  assert.equal(hasBracketData(basePayload()), true);
});

test("hasBracketData lists tournaments with confirmed matches", () => {
  const p = {
    drawn: false,
    teams: [{ id: "t1", name: "A", players: [] }],
    bracket: {
      wb: [[{ id: "m1", confirmed: true, scoreA: 2, scoreB: 0 }]],
      lb: [],
      matches: [{ id: "m1", confirmed: true }],
    },
  };
  assert.equal(hasBracketData(p), true);
});

test("mergePayload prefers cloud when savedAt and confirmed matches are newer", () => {
  const local = basePayload({
    savedAt: "2026-05-01T10:00:00.000Z",
    bracket: {
      wb: [[{ id: "m1", confirmed: true, scoreA: 2, scoreB: 0 }]],
      lb: [],
      matches: [{ id: "m1", confirmed: true, scoreA: 2, scoreB: 0 }],
    },
  });
  const cloud = basePayload({
    savedAt: "2026-05-01T11:00:00.000Z",
    bracket: {
      wb: [[{ id: "m1", confirmed: true, scoreA: 2, scoreB: 1 }]],
      lb: [],
      matches: [{ id: "m1", confirmed: true, scoreA: 2, scoreB: 1 }],
    },
  });
  const merged = mergePayload(local, cloud);
  assert.equal(merged.bracket.matches[0].scoreB, 1);
  assert.ok(payloadScore(cloud) > payloadScore(local));
});

test("mergePayload does not prefer stale local when draw dates are equal", () => {
  const drawnAt = "2026-03-15T18:00:00.000Z";
  const local = basePayload({
    savedAt: "2026-03-15T18:00:00.000Z",
    drawInfo: { drawnAt },
    bracket: {
      wb: [[{ id: "m1", confirmed: false }]],
      lb: [],
      matches: [],
    },
  });
  const cloud = basePayload({
    savedAt: "2026-05-20T20:00:00.000Z",
    drawInfo: { drawnAt },
    bracket: {
      wb: [[{ id: "m1", confirmed: true, winner: "t1" }]],
      lb: [],
      matches: [{ id: "m1", confirmed: true, winner: "t1" }],
    },
  });
  const merged = mergePayload(local, cloud);
  assert.equal(merged.bracket.matches[0].confirmed, true);
});

test("mergePayload uses newer remote teams instead of resurrecting stale local players", () => {
  const local = basePayload({
    savedAt: "2026-05-01T10:00:00.000Z",
    teams: [{ id: "t1", name: "Clan viejo", players: ["Jugador viejo"] }],
  });
  const cloud = basePayload({
    savedAt: "2026-05-01T11:00:00.000Z",
    teams: [{ id: "t1", name: "Clan nuevo", players: ["Jugador actual"] }],
  });

  const merged = mergePayload(local, cloud, { prefer: "cloud" });

  assert.deepEqual(merged.teams, cloud.teams);
});

test("mergePayload prefers remote teams on equal timestamps when requested", () => {
  const savedAt = "2026-05-01T11:00:00.000Z";
  const local = basePayload({
    savedAt,
    teams: [{ id: "t1", name: "Clan viejo", players: ["Jugador viejo"] }],
  });
  const cloud = basePayload({
    savedAt,
    teams: [{ id: "t1", name: "Clan nuevo", players: ["Jugador actual"] }],
  });

  const merged = mergePayload(local, cloud, { prefer: "cloud" });

  assert.equal(merged.teams[0].players[0], "Jugador actual");
});

test("resolveAuthoritativePayload prefers cloud when local savedAt is newer but roster is stale", () => {
  const drawnAt = "2026-05-20T01:00:00.000Z";
  const local = basePayload({
    savedAt: "2026-05-26T12:00:00.000Z",
    drawInfo: { drawnAt },
    teams: [{ id: "t1", name: "Clan viejo", players: ["Jugador viejo"] }],
    bracket: {
      wb: [[{ id: "m1", confirmed: true, scoreA: 2, scoreB: 0 }]],
      lb: [],
      matches: [{ id: "m1", confirmed: true, scoreA: 2, scoreB: 0 }],
    },
  });
  const cloud = basePayload({
    savedAt: "2026-05-24T22:00:00.000Z",
    drawInfo: { drawnAt },
    teams: [{ id: "t1", name: "Clan nuevo", players: ["Jugador actual"] }],
    bracket: {
      wb: [[{ id: "m1", confirmed: true, scoreA: 2, scoreB: 1 }]],
      lb: [],
      matches: [{ id: "m1", confirmed: true, scoreA: 2, scoreB: 1 }],
    },
  });

  const merged = resolveAuthoritativePayload(local, cloud, { prefer: "cloud" });

  assert.equal(rosterSignature(merged), rosterSignature(cloud));
  assert.equal(merged.teams[0].players[0], "Jugador actual");
  assert.equal(merged.bracket.matches[0].scoreB, 1);
});

test("resolvePublicPayload prefers cloud bracket over stale local cache", () => {
  const local = {
    drawn: false,
    teams: [{ id: "t1", name: "Local", players: [] }],
    savedAt: "2026-05-26T12:00:00.000Z",
  };
  const cloud = basePayload({
    savedAt: "2026-05-20T20:00:00.000Z",
    teams: [{ id: "t1", name: "Nube", players: ["p1"] }],
  });
  const merged = resolvePublicPayload(local, cloud);
  assert.equal(hasBracketData(merged), true);
  assert.equal(merged.teams[0].name, "Nube");
});

test("resolvePublicPayload prefers cloud when it has more confirmed matches", () => {
  const local = basePayload({
    savedAt: "2026-05-26T12:00:00.000Z",
    bracket: {
      wb: [[{ id: "m1", confirmed: true, scoreA: 2, scoreB: 0 }]],
      lb: [],
      matches: [{ id: "m1", confirmed: true, scoreA: 2, scoreB: 0 }],
    },
  });
  const cloud = basePayload({
    savedAt: "2026-05-20T20:00:00.000Z",
    bracket: {
      wb: [
        [
          { id: "m1", confirmed: true, scoreA: 2, scoreB: 0 },
          { id: "m2", confirmed: true, scoreA: 2, scoreB: 1 },
        ],
      ],
      lb: [],
      matches: [
        { id: "m1", confirmed: true, scoreA: 2, scoreB: 0 },
        { id: "m2", confirmed: true, scoreA: 2, scoreB: 1 },
      ],
    },
  });
  const merged = resolvePublicPayload(local, cloud);
  assert.equal(merged.bracket.matches.length, 2);
  assert.equal(merged.bracket.matches[1].id, "m2");
});

test("isIncomingStaleWrite allows saves with more confirmed results", () => {
  const current = basePayload({
    savedAt: "2026-05-26T12:00:00.000Z",
    bracket: {
      wb: [[{ id: "m1", confirmed: true }]],
      lb: [],
      matches: [{ id: "m1", confirmed: true }],
    },
  });
  const incoming = basePayload({
    savedAt: "2026-05-20T20:00:00.000Z",
    bracket: {
      wb: [[{ id: "m1", confirmed: true }, { id: "m2", confirmed: true }]],
      lb: [],
      matches: [
        { id: "m1", confirmed: true },
        { id: "m2", confirmed: true },
      ],
    },
  });
  assert.equal(isIncomingStaleWrite(incoming, current), false);
});

test("isIncomingStaleWrite never blocks first bracket publish", () => {
  const current = basePayload({
    teams: [],
    drawn: false,
    bracket: null,
    preliminary: null,
    drawInfo: null,
    savedAt: "2026-05-26T12:00:00.000Z",
  });
  const incoming = basePayload({
    drawn: true,
    savedAt: "2026-05-26T11:00:00.000Z",
    drawInfo: { drawnAt: "2026-05-26T11:00:00.000Z" },
    bracket: {
      wb: [[{ id: "m1" }]],
      lb: [],
      matches: [{ id: "m1" }],
    },
  });
  assert.equal(isIncomingStaleWrite(incoming, current), false);
});

test("shouldApplyRemotePayload detects newer remote state", () => {
  const current = basePayload({
    bracket: {
      wb: [[{ id: "m1", confirmed: true }]],
      lb: [],
      matches: [{ id: "m1", confirmed: true }],
    },
  });
  const incoming = basePayload({
    bracket: {
      wb: [[{ id: "m1", confirmed: true }, { id: "m2", confirmed: true }]],
      lb: [],
      matches: [
        { id: "m1", confirmed: true },
        { id: "m2", confirmed: true },
      ],
    },
  });
  assert.equal(shouldApplyRemotePayload(current, incoming), true);
  assert.equal(shouldApplyRemotePayload(incoming, current), false);
});

test("feedBlocksSide ignores direct seed without feed", () => {
  const match = { teamA: "t1", feedA: null };
  assert.equal(feedBlocksSide(match, "A", () => null), false);
});

test("feedBlocksSide blocks when feed unresolved even with stale team id", () => {
  const match = {
    teamA: "t1",
    feedA: { matchId: "prev", slot: "winner" },
  };
  assert.equal(feedBlocksSide(match, "A", () => null), true);
  assert.equal(feedBlocksSide(match, "A", () => "t1"), false);
});

test("feedBlocksSide blocks when feed unresolved and no direct team", () => {
  const match = { feedB: { matchId: "prev", slot: "winner" } };
  assert.equal(feedBlocksSide(match, "B", () => null), true);
  assert.equal(feedBlocksSide(match, "B", () => "t9"), false);
});
