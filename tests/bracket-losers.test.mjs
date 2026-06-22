import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildDoubleElimBracket,
  buildLb0,
  feed,
  rebuildLbFromDrop,
  repairOrphanPrelimLbEntries,
  repairOrphanWbLosersToLb,
  repairLbProgressionFromLb0,
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

function winnerDestRound(bracket, match) {
  return (bracket.matches || [])
    .filter(
      (x) =>
        (x.feedA?.matchId === match.id && x.feedA?.slot === "winner") ||
        (x.feedB?.matchId === match.id && x.feedB?.slot === "winner")
    )
    .map((x) => x.round);
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

test("18 equipos: prelim en ronda propia y bajada WB en LB R2", () => {
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
    matches: [...lb0],
    grand: null,
    _prelimLbFeed: prelim.feedA,
  };

  rebuildLbFromDrop(bracket, mk);

  assert.equal(bracket.lb[0].length, 4);
  assert.ok(bracket.lb[1]?.length >= 4, "LB R2: bajada WB con todos los perdedores");
  assert.ok(bracket.lbPrelimRounds?.length >= 1, "prelim LB cuando hay clasificado extra");
  assert.deepEqual(findOrphanWbLosers(bracket), []);
  assert.deepEqual(validateLbWinnerDestinations(bracket), []);

  for (const m of bracket.lb[0]) {
    const rounds = winnerDestRound(bracket, m);
    assert.ok(rounds.length, `LB R1 ${m.id} sin destino`);
    assert.ok(
      rounds.every((r) => r === 1 || r === 0),
      `LB R1 ${m.id} salta ronda (${rounds.join(",")})`
    );
  }
});

test("lokito: clasificado prelim entra en primera bajada WB sin saltar rondas", () => {
  const wb = makeWb16();
  let seq = 0;
  const mk = () => `m-${seq++}`;
  const { lb0 } = buildLb0(wb, mk);
  const solo = createMatch(mk(), "losers", 0, 4);
  solo.feedA = { matchId: "pre-0", slot: "loser" };
  lb0.push(solo);
  const bracket = { wb, lb: [lb0], matches: [...lb0], grand: null };
  bracket._prelimLbFeed = solo.feedA;

  const wired = wireLokitoVsLb0WinnerInLb1(bracket, mk, -1);

  assert.equal(wired.changed, true);
  assert.equal(bracket.lb[0].length, 4);
  assert.ok(bracket.lb[1]?.length >= 4);
  assert.ok(bracket.lbPrelimRounds?.length >= 1);
  for (const m of bracket.lb[0]) {
    const destRounds = winnerDestRound(bracket, m);
    assert.ok(destRounds.length, `LB R1 ${m.id} sin destino`);
    assert.ok(
      destRounds.every((r) => r === 1 || r === 0),
      `LB R1 ${m.id} salta ronda ${destRounds.join(",")}`
    );
  }
  assert.deepEqual(findOrphanWbLosers(bracket), []);
  assert.deepEqual(findIntraRoundLbFeedIssues(bracket), []);
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
  const drop = bracket.lb[1]?.[3];
  assert.ok(drop, "cruce de bajada WB para cuartos 4");
  drop.feedB = null;
  drop.teamB = `bye-${drop.id}`;
  assert.ok(findOrphanWbLosers(bracket).some((m) => m.id === orphan.id));
  const repaired = repairOrphanWbLosersToLb(bracket, mk);
  assert.equal(repaired.changed, true);
  assert.deepEqual(findOrphanWbLosers(bracket), []);
  assert.equal(drop.feedB?.matchId, orphan.id);
});

test("sin BYE fantasma en repechaje principal tras repairLbProgressionFromLb0", () => {
  const wb = makeWb16();
  let seq = 0;
  const mk = () => `m-${seq++}`;
  const { lb0 } = buildLb0(wb, mk);
  const bracket = { wb, lb: [lb0], matches: [...lb0], grand: null };
  bracket._prelimLbFeed = { matchId: "pre-0", slot: "winner" };
  rebuildLbFromDrop(bracket, mk);
  const ghosts = bracket.matches.filter(
    (m) => m.bracket === "losers" && (m.teamB?.startsWith("bye-") || m.teamA?.startsWith("bye-"))
  );
  assert.equal(ghosts.length, 0);
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
});
