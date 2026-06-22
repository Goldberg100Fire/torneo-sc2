import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildDoubleElimBracket,
  buildLb0,
  buildLb1WithPrelimBridge,
  feed,
  rebuildLbFromDrop,
  repairOrphanPrelimLbEntries,
  repairOrphanWbLosersToLb,
  findOrphanWbLosers,
  validateLbWinnerDestinations,
  findIntraRoundLbFeedIssues,
  wireLokitoVsLb0WinnerInLb1,
  createMatch,
} from "../bracket-engine.mjs";

function makeWb16() {
  let seq = 0;
  const mk = () => `wb-${seq++}`;
  const ids = Array.from({ length: 16 }, (_, i) => `t${i}`);
  return buildDoubleElimBracket(ids, mk).wb;
}

test("16 equipos: todos los cruces LB tienen destino de ganador", () => {
  let seq = 0;
  const mk = () => `m-${seq++}`;
  const bracket = buildDoubleElimBracket(
    Array.from({ length: 16 }, (_, i) => `t${i}`),
    mk
  );
  assert.deepEqual(validateLbWinnerDestinations(bracket), []);
  assert.equal(bracket.lb[0].length, 4);
  assert.deepEqual(findIntraRoundLbFeedIssues(bracket), []);
});

test("18 equipos (prelim extra en lb[0]): lb[1] absorbe el cruce sobrante", () => {
  const wb = makeWb16();
  let seq = 0;
  const mk = () => `m-${seq++}`;
  const lb0 = [];
  for (let m = 0; m < 4; m++) {
    const match = createMatch(mk(), "losers", 0, m);
    match.feedA = feed(wb[0][m * 2], "loser");
    match.feedB = feed(wb[0][m * 2 + 1], "loser");
    lb0.push(match);
  }
  const prelim = createMatch(mk(), "losers", 0, 4);
  prelim.feedA = { matchId: "pre-0", slot: "loser" };
  prelim.teamB = `bye-${prelim.id}`;

  lb0.push(prelim);
  const bracket = {
    wb,
    lb: [lb0],
    matches: [...lb0, prelim],
    grand: null,
  };

  rebuildLbFromDrop(bracket, mk);

  assert.equal(bracket.lb[0].length, 5);
  assert.ok(bracket.lb[1].length >= 5, "LB R1 debe tener al menos 5 cruces");
  assert.deepEqual(validateLbWinnerDestinations(bracket), []);
  assert.deepEqual(findIntraRoundLbFeedIssues(bracket), []);
});

test("lokito: puente en ronda propia; bajada WB en la siguiente", () => {
  const wb = makeWb16();
  let seq = 0;
  const mk = () => `m-${seq++}`;
  const { lb0 } = buildLb0(wb, mk);
  const solo = createMatch(mk(), "losers", 0, 4);
  solo.feedA = { matchId: "pre-0", slot: "loser" };
  lb0.push(solo);
  const bracket = { wb, lb: [lb0, []], matches: [...lb0, solo], grand: null };
  bracket._prelimLbFeed = solo.feedA;

  const wired = wireLokitoVsLb0WinnerInLb1(bracket, mk, -1);

  assert.equal(wired.changed, true);
  assert.equal(bracket.lb[0].length, 4);
  const host = bracket.lb[0][3];
  const bridge = bracket.lb[1]?.[3];
  assert.ok(bridge);
  assert.equal(bridge.round, 1);
  assert.equal(bridge.feedA?.matchId, host.id);
  assert.equal(bridge.feedB?.matchId, "pre-0");
  assert.equal(bracket.lb[1].length, 4);
  for (const m of bracket.lb[0]) {
    const next = bracket.matches.filter(
      (x) =>
        (x.feedA?.matchId === m.id && x.feedA?.slot === "winner") ||
        (x.feedB?.matchId === m.id && x.feedB?.slot === "winner")
    );
    assert.ok(next.length, `LB R1 ${m.id} sin destino`);
    assert.ok(
      next.every((d) => d.round === 1),
      `LB R1 ${m.id} salta a ronda ${next.map((d) => d.round + 1).join(",")}`
    );
  }
  assert.deepEqual(findIntraRoundLbFeedIssues(bracket), []);
});

test("buildLb1WithPrelimBridge: puente y bajadas WB en la misma ronda LB", () => {
  const wb = makeWb16();
  let seq = 0;
  const mk = () => `m-${seq++}`;
  const { lb0 } = buildLb0(wb, mk);
  const built = buildLb1WithPrelimBridge(lb0, wb[1], 3, { matchId: "pre-0", slot: "winner" }, mk);
  assert.equal(built.round.length, 4);
  assert.equal(built.round[3].feedB?.matchId, "pre-0");
  assert.equal(built.round[0].feedB?.matchId, wb[1][0].id);
  for (const m of lb0) {
    const next = built.round.filter(
      (x) => x.feedA?.matchId === m.id && x.feedA?.slot === "winner"
    );
    assert.equal(next.length, 1, `LB R1 ${m.id} debe ir a LB R2`);
  }
  assert.deepEqual(findIntraRoundLbFeedIssues({ lb: [lb0, built.round] }), []);
});

test("prelim bridge: ningún perdedor WB queda sin repechaje", () => {
  let seq = 0;
  const mk = () => `m-${seq++}`;
  const bracket = buildDoubleElimBracket(
    Array.from({ length: 16 }, (_, i) => `t${i}`),
    mk
  );
  bracket._prelimLbFeed = { matchId: "pre-0", slot: "winner" };
  rebuildLbFromDrop(bracket, mk);
  assert.deepEqual(findOrphanWbLosers(bracket), []);
  assert.deepEqual(validateLbWinnerDestinations(bracket), []);
});

test("repairOrphanWbLosersToLb enlaza cuartos huérfano en torneo ya guardado", () => {
  let seq = 0;
  const mk = () => `m-${seq++}`;
  const bracket = buildDoubleElimBracket(
    Array.from({ length: 16 }, (_, i) => `t${i}`),
    mk
  );
  bracket._prelimLbFeed = { matchId: "pre-0", slot: "winner" };
  rebuildLbFromDrop(bracket, mk);
  const orphan = bracket.wb[1][3];
  const drop = bracket.lb[2][2];
  drop.feedB = null;
  drop.teamB = `bye-${drop.id}`;
  assert.ok(findOrphanWbLosers(bracket).some((m) => m.id === orphan.id));
  const repaired = repairOrphanWbLosersToLb(bracket, mk);
  assert.equal(repaired.changed, true);
  assert.deepEqual(findOrphanWbLosers(bracket), []);
  assert.equal(drop.feedB?.matchId, orphan.id);
});

test("con LB confirmados: no borra ni altera partidos ya jugados", () => {
  let seq = 0;
  const mk = () => `m-${seq++}`;
  const bracket = buildDoubleElimBracket(
    Array.from({ length: 16 }, (_, i) => `t${i}`),
    mk
  );
  const confirmed = bracket.lb[1][0];
  confirmed.confirmed = true;
  confirmed.winner = "t0";
  confirmed.loser = "t1";
  confirmed.scoreA = 3;
  confirmed.scoreB = 1;
  const confirmedId = confirmed.id;
  const confirmedScoreB = confirmed.scoreB;

  const prelim = createMatch(mk(), "losers", 0, 4);
  prelim.feedA = { matchId: "pre-0", slot: "loser" };
  prelim.teamB = `bye-${prelim.id}`;
  bracket.lb[0].push(prelim);
  bracket.matches.push(prelim);

  repairOrphanPrelimLbEntries(bracket, mk);

  assert.equal(bracket.lb[1][0].id, confirmedId);
  assert.equal(bracket.lb[1][0].scoreB, confirmedScoreB);
  assert.equal(bracket.lb[1][0].confirmed, true);
  assert.equal(bracket.lb[0].length, 4);
  assert.ok(!bracket.lb[0].some((m) => m.id === prelim.id));
  assert.ok(
    bracket.lb[1].some(
      (m) => m.feedB?.matchId === "pre-0" && m.feedA?.slot === "winner"
    )
  );
});
