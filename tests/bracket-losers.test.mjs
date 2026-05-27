import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildDoubleElimBracket,
  feed,
  rebuildLbFromDrop,
  repairOrphanPrelimLbEntries,
  validateLbWinnerDestinations,
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
  assert.ok(
    bracket.matches.some(
      (m) => m.feedA?.matchId === prelim.id && m.feedA?.slot === "winner"
    )
  );
});
