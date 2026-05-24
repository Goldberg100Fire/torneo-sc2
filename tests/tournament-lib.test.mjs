import { test } from "node:test";
import assert from "node:assert/strict";
import { createTournamentLib } from "../tournament-lib.mjs";

const lib = createTournamentLib({ maxPlayersPerTeam: 6 });
const {
  hasBracketData,
  payloadScore,
  mergePayload,
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

test("hasBracketData requires drawn flag", () => {
  assert.equal(hasBracketData({ bracket: { wb: [[]] } }), false);
  assert.equal(hasBracketData(basePayload()), true);
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

test("feedBlocksSide ignores stale feed when direct team is set", () => {
  const match = {
    teamA: "t1",
    feedA: { matchId: "prev", slot: "winner" },
  };
  const resolveFeed = () => null;
  assert.equal(feedBlocksSide(match, "A", resolveFeed), false);
});

test("feedBlocksSide blocks when feed unresolved and no direct team", () => {
  const match = { feedB: { matchId: "prev", slot: "winner" } };
  assert.equal(feedBlocksSide(match, "B", () => null), true);
  assert.equal(feedBlocksSide(match, "B", () => "t9"), false);
});
