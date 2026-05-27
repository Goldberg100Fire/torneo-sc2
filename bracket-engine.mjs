/**
 * Generación y reparación del cuadro de repechaje (doble eliminación).
 * Usado en admin y en tests.
 */

export function feed(match, slot) {
  return { matchId: match.id, slot };
}

export function createMatch(id, bracket, round, index) {
  return {
    id,
    bracket,
    round,
    index,
    teamA: null,
    teamB: null,
    scoreA: null,
    scoreB: null,
    winner: null,
    loser: null,
    confirmed: false,
    feedA: null,
    feedB: null,
    bestOf: 5,
    wbAdvantage: false,
    playedAt: null,
    scheduledAt: null,
  };
}

export function buildLb0(wb, mkId) {
  const lb0 = [];
  const matches = [];
  for (let m = 0; m < wb[0].length / 2; m++) {
    const match = createMatch(mkId(), "losers", 0, m);
    match.feedA = feed(wb[0][m * 2], "loser");
    match.feedB = feed(wb[0][m * 2 + 1], "loser");
    matches.push(match);
    lb0.push(match);
  }
  return { lb0, matches };
}

/**
 * A partir de lb[0] ya definido, genera lb[1..] y devuelve cruces nuevos.
 */
export function extendLbRoundsFrom(wb, lb, startLbR, startWbDrop, mkId) {
  const matches = [];
  const wbRounds = wb.length;
  let lbR = startLbR;
  let wbDrop = startWbDrop;

  while (lbR < 20) {
    const prev = lb[lbR - 1];
    if (!prev?.length) break;

    if (wbDrop < wbRounds) {
      lb[lbR] = [];
      const wbRound = wb[wbDrop];
      let wi = 0;
      for (let pi = 0; pi < prev.length; ) {
        const match = createMatch(mkId(), "losers", lbR, lb[lbR].length);
        match.feedA = feed(prev[pi++], "winner");
        if (wi < wbRound.length) {
          match.feedB = feed(wbRound[wi++], "loser");
        } else if (pi < prev.length) {
          match.feedB = feed(prev[pi++], "winner");
        } else {
          match.teamB = `bye-${match.id}`;
        }
        matches.push(match);
        lb[lbR].push(match);
      }
      lbR++;
      wbDrop++;

      const prev2 = lb[lbR - 1];
      if (prev2.length > 1) {
        lb[lbR] = [];
        const pairCount = Math.floor(prev2.length / 2);
        for (let i = 0; i < pairCount; i++) {
          const match = createMatch(mkId(), "losers", lbR, i);
          match.feedA = feed(prev2[i * 2], "winner");
          match.feedB = feed(prev2[i * 2 + 1], "winner");
          matches.push(match);
          lb[lbR].push(match);
        }
        if (prev2.length % 2 === 1) {
          const carry = createMatch(mkId(), "losers", lbR, lb[lbR].length);
          carry.feedA = feed(prev2[prev2.length - 1], "winner");
          matches.push(carry);
          lb[lbR].push(carry);
        }
        lbR++;
      }
    } else {
      break;
    }
  }

  return { matches, lbR };
}

/** Rondas LB completas desde cero (potencia de 2, sin prelim extra en lb[0]). */
export function buildLbRounds(wb, mkId) {
  const lb = [];
  const lb0Built = buildLb0(wb, mkId);
  lb[0] = lb0Built.lb0;
  const ext = extendLbRoundsFrom(wb, lb, 1, 1, mkId);
  return {
    lb: lb.filter((r) => r?.length),
    matches: [...lb0Built.matches, ...ext.matches],
    lbR: ext.lbR,
  };
}

export function attachLbFinalAndGrand(wb, lb, lbR, mkId) {
  const matches = [];
  const wbFinal = wb[wb.length - 1][0];
  const lastLbRound = lb[lb.length - 1];
  if (!lastLbRound?.length) throw new Error("Cuadro de repechaje inválido");

  let lastLb = lastLbRound[0];
  const feedsWbFinalLoser =
    lastLb.feedA?.matchId === wbFinal.id || lastLb.feedB?.matchId === wbFinal.id;

  if (!feedsWbFinalLoser) {
    lastLb = createMatch(mkId(), "losers", lbR, 0);
    lastLb.feedA = feed(lb[lb.length - 1][0], "winner");
    lastLb.feedB = feed(wbFinal, "loser");
    matches.push(lastLb);
    lb.push([lastLb]);
  }

  const grand = createMatch(mkId(), "grand", 0, 0);
  grand.feedA = feed(wbFinal, "winner");
  grand.feedB = feed(lastLb, "winner");
  matches.push(grand);

  return { grand, matches };
}

export function buildDoubleElimBracket(seededTeamIds, mkId) {
  const n = seededTeamIds.length;
  const matches = [];
  let seq = 0;
  const nextId = () => mkId(seq++);
  const wbRounds = Math.log2(n);
  const wb = [];

  for (let r = 0; r < wbRounds; r++) {
    wb[r] = [];
    const count = n / Math.pow(2, r + 1);
    for (let m = 0; m < count; m++) {
      const match = createMatch(nextId(), "winners", r, m);
      matches.push(match);
      wb[r].push(match);
    }
  }

  for (let m = 0; m < wb[0].length; m++) {
    wb[0][m].teamA = seededTeamIds[m * 2];
    wb[0][m].teamB = seededTeamIds[m * 2 + 1];
  }

  for (let r = 1; r < wbRounds; r++) {
    for (let m = 0; m < wb[r].length; m++) {
      wb[r][m].feedA = feed(wb[r - 1][m * 2], "winner");
      wb[r][m].feedB = feed(wb[r - 1][m * 2 + 1], "winner");
    }
  }

  const lbBuilt = buildLbRounds(wb, nextId);
  const lb = lbBuilt.lb;
  matches.push(...lbBuilt.matches);

  const tail = attachLbFinalAndGrand(wb, lb, lbBuilt.lbR, nextId);
  matches.push(...tail.matches);

  return { matches, wb, lb, grand: tail.grand, size: n };
}

function collectLbMatchIds(lb, fromRound) {
  const ids = new Set();
  for (let r = fromRound; r < lb.length; r++) {
    for (const m of lb[r] || []) ids.add(m.id);
  }
  return ids;
}

/**
 * Reconstruye lb[1] en adelante y la gran final según lb[0] real
 * (p. ej. tras añadir lb-pre-entry por preliminares).
 */
export function rebuildLbFromDrop(bracket, mkId) {
  const wb = bracket.wb;
  if (!wb?.length || !bracket.lb?.[0]?.length) return false;

  const stripFrom = 1;
  const removed = collectLbMatchIds(bracket.lb, stripFrom);
  if (bracket.grand) removed.add(bracket.grand.id);

  bracket.lb = bracket.lb.slice(0, stripFrom);
  bracket.matches = (bracket.matches || []).filter((m) => !removed.has(m.id));
  bracket.grand = null;

  let seq = bracket.matches.length;
  const nextId = () => mkId(seq++);

  const ext = extendLbRoundsFrom(wb, bracket.lb, 1, 1, nextId);
  bracket.matches.push(...ext.matches);

  const tail = attachLbFinalAndGrand(wb, bracket.lb, ext.lbR, nextId);
  bracket.matches.push(...tail.matches);
  bracket.grand = tail.grand;

  return true;
}

export function matchHasWinnerDestination(bracket, matchId) {
  return (bracket.matches || []).some(
    (m) =>
      (m.feedA?.matchId === matchId && m.feedA?.slot === "winner") ||
      (m.feedB?.matchId === matchId && m.feedB?.slot === "winner")
  );
}

export function standardLb0Count(bracket) {
  return bracket.wb?.[0]?.length ? bracket.wb[0].length / 2 : 0;
}

export function isPrelimSoloLb0Match(match, stdCount) {
  if (!match || match.bracket !== "losers" || match.round !== 0) return false;
  if (match.id?.startsWith("lb-pre-entry")) return true;
  if (stdCount > 0 && match.index >= stdCount) return true;
  return !!(match.feedA && !match.feedB && !match.teamB);
}

export function findPrelimSoloLb0(bracket) {
  const lb0 = bracket.lb?.[0];
  if (!lb0?.length) return null;
  const std = standardLb0Count(bracket);
  return lb0.find((m) => isPrelimSoloLb0Match(m, std)) || null;
}

/** Cruces lb-pre-entry en lb[0] sin destino para el ganador. */
export function findOrphanPrelimLbEntries(bracket) {
  const lb0 = bracket.lb?.[0];
  if (!lb0?.length) return [];
  const std = standardLb0Count(bracket);
  return lb0
    .slice(std)
    .filter((m) => !matchHasWinnerDestination(bracket, m.id));
}

/** Último cruce LB R1 no confirmado (p. ej. R104) donde encajar el preliminar. */
export function findLb0MergeDonor(bracket, solo) {
  const std = standardLb0Count(bracket);
  const candidates = (bracket.lb?.[0] || []).filter(
    (m) =>
      m.id !== solo?.id &&
      m.index < std &&
      !m.confirmed &&
      m.feedA &&
      m.feedB &&
      !m.id?.startsWith("lb-pre-entry")
  );
  return candidates.length ? candidates[candidates.length - 1] : null;
}

/** El perdedor WB desplazado entra en LB R2 (lb[1]) sin pasar por un 5.º cruce en R1. */
export function wireDisplacedWbLoserToLb1(bracket, displacedFeed, mkId) {
  if (!displacedFeed) return false;
  if (!bracket.lb[1]) bracket.lb[1] = [];

  for (const m of bracket.lb[1]) {
    if (m.confirmed) continue;
    if (m.feedA && !m.feedB) {
      m.feedB = displacedFeed;
      return true;
    }
    if (!m.feedA && m.feedB) {
      m.feedA = displacedFeed;
      return true;
    }
  }

  const match = createMatch(mkId(), "losers", 1, bracket.lb[1].length);
  match.feedA = displacedFeed;
  bracket.lb[1].push(match);
  bracket.matches.push(match);
  return true;
}

/**
 * En lugar de un 5.º cruce solo: el preliminar entra en un cruce de los 4
 * (no confirmado) y el rival WB desplazado baja a LB R2.
 */
export function mergePrelimSoloIntoLb0(bracket, mkId) {
  const solo = findPrelimSoloLb0(bracket);
  if (!solo) return { changed: false, preservedConfirmed: lbHasAnyConfirmed(bracket) };

  const donor = findLb0MergeDonor(bracket, solo);
  if (!donor) return { changed: false, preservedConfirmed: lbHasAnyConfirmed(bracket) };

  const displacedFeed = donor.feedB;
  const prelimFeed = solo.feedA;
  if (!prelimFeed) return { changed: false, preservedConfirmed: lbHasAnyConfirmed(bracket) };

  if (solo.confirmed) {
    if (!solo.feedB && !solo.teamB) {
      solo.feedB = displacedFeed;
      donor.feedB = null;
      donor.teamB = null;
      return { changed: true, preservedConfirmed: true };
    }
    return { changed: false, preservedConfirmed: true };
  }

  donor.feedB = prelimFeed;
  donor.teamB = null;

  const soloId = solo.id;
  bracket.lb[0] = bracket.lb[0].filter((m) => m.id !== soloId);
  bracket.matches = (bracket.matches || []).filter((m) => m.id !== soloId);
  bracket.lb[0].forEach((m, i) => {
    m.index = i;
  });

  const hasConfirmed = lbHasAnyConfirmed(bracket);
  let seq = bracket.matches.length;
  const nextId = () => mkId(seq++);

  if (!hasConfirmed) {
    rebuildLbFromDrop(bracket, nextId);
    wireDisplacedWbLoserToLb1(bracket, displacedFeed, nextId);
    return { changed: true, preservedConfirmed: false };
  }

  wireDisplacedWbLoserToLb1(bracket, displacedFeed, nextId);
  return { changed: true, preservedConfirmed: true };
}

export function lbHasAnyConfirmed(bracket) {
  return (bracket.lb || []).some((round) => round?.some((m) => m.confirmed));
}

/** Añade solo cruces nuevos; no modifica partidos existentes (confirmados o no). */
function repairOrphanPrelimMinimal(bracket, mkId, orphans) {
  let changed = false;
  if (!bracket.lb[1]) bracket.lb[1] = [];

  const usedWbLosers = new Set();
  for (const m of bracket.lb[1]) {
    if (m.feedB?.slot === "loser") usedWbLosers.add(m.feedB.matchId);
  }

  for (const entry of orphans) {
    if (matchHasWinnerDestination(bracket, entry.id)) continue;

    const match = createMatch(mkId(), "losers", 1, bracket.lb[1].length);
    match.feedA = feed(entry, "winner");
    const wb1 = bracket.wb?.[1] || [];
    const freeWb = wb1.find((w) => !usedWbLosers.has(w.id));
    if (freeWb) {
      match.feedB = feed(freeWb, "loser");
      usedWbLosers.add(freeWb.id);
    }
    bracket.lb[1].push(match);
    bracket.matches.push(match);
    changed = true;
  }
  return changed;
}

/**
 * Repara lb-pre-entry sin destino.
 * Si hay cruces LB confirmados: solo añade el enlace faltante (nunca borra ni edita partidos).
 */
export function repairOrphanPrelimLbEntries(bracket, mkId) {
  const solo = findPrelimSoloLb0(bracket);
  if (solo) {
    const merged = mergePrelimSoloIntoLb0(bracket, mkId);
    if (merged.changed) return merged;
  }

  const orphans = findOrphanPrelimLbEntries(bracket);
  if (!orphans.length) return { changed: false, preservedConfirmed: false };

  let seq = bracket.matches.length;
  const nextId = () => mkId(seq++);
  const hasConfirmed = lbHasAnyConfirmed(bracket);
  let changed = false;

  if (!hasConfirmed) {
    for (const entry of orphans) {
      if (entry.confirmed) continue;
      if (entry.feedA && !entry.feedB && !entry.teamB) {
        entry.teamB = `bye-${entry.id}`;
        changed = true;
      }
    }
    if (rebuildLbFromDrop(bracket, nextId)) changed = true;
    return { changed, preservedConfirmed: false };
  }

  if (repairOrphanPrelimMinimal(bracket, nextId, orphans)) changed = true;
  return { changed, preservedConfirmed: true };
}

/** Todos los cruces de repechaje (salvo gran final) deben tener al menos un feed de salida. */
export function validateLbWinnerDestinations(bracket) {
  const issues = [];
  const wb = bracket.wb;
  if (!wb?.length) return issues;

  for (const round of bracket.lb || []) {
    for (const m of round || []) {
      if (!matchHasWinnerDestination(bracket, m.id)) {
        issues.push(m.id);
      }
    }
  }
  return issues;
}
