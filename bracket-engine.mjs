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

export function findPrelimLbFeed(bracket) {
  const solo = findPrelimSoloLb0(bracket);
  if (solo?.feedA) return solo.feedA;
  const extra = bracket.matches?.find((m) => m.id?.startsWith("lb-pre-entry"));
  if (extra?.feedA) return extra.feedA;
  return bracket._prelimLbFeed || null;
}

/** Restaura feeds WB en LB R1 si un arreglo anterior metió al preliminar dentro del cruce. */
export function restoreLb0IfPrelimMerged(bracket) {
  const wb = bracket.wb;
  const lb0 = bracket.lb?.[0];
  if (!wb?.[0] || !lb0?.length) return false;

  const std = standardLb0Count(bracket);
  let changed = false;
  const wbIds = new Set(wb[0].map((m) => m.id));

  for (let i = 0; i < std; i++) {
    const m = lb0[i];
    if (!m?.feedA || !m.feedB || m.confirmed) continue;
    const expectB = feed(wb[0][i * 2 + 1], "loser");
    if (m.feedB.matchId === expectB.matchId) continue;
    if (!wbIds.has(m.feedB.matchId)) {
      m.feedB = expectB;
      m.teamB = null;
      changed = true;
    }
  }
  return changed;
}

function findLokitoBridgeMatch(bracket, host, prelimFeed) {
  if (!host || !prelimFeed) return null;
  return (
    bracket.matches?.find(
      (m) =>
        m.bracket === "losers" &&
        m.round === 1 &&
        m.feedA?.matchId === host.id &&
        m.feedA?.slot === "winner" &&
        m.feedB?.matchId === prelimFeed.matchId &&
        m.id !== bracket.lb?.[1]?.[host.index]?.id
    ) || null
  );
}

/** Restaura perdedor WB en LB R2 si Lokito ocupó su hueco por error. */
function restoreLb1WbDropsIfPrelimStoleSlot(bracket, prelimFeed) {
  const wb1 = bracket.wb?.[1];
  if (!wb1?.length || !prelimFeed) return false;
  let changed = false;
  for (let i = 0; i < wb1.length; i++) {
    const drop = bracket.lb?.[1]?.[i];
    if (!drop || drop.confirmed) continue;
    if (drop.feedB?.matchId === prelimFeed.matchId) {
      drop.feedB = feed(wb1[i], "loser");
      drop.teamB = null;
      changed = true;
    }
  }
  return changed;
}

/**
 * LB R1: 4 cruces intactos.
 * Puente LB R2: ganador(cruce host) vs Lokito.
 * Cruce LB R2 host: ganador(puente) vs perdedor WB (bajada Winners conservada).
 */
export function wireLokitoVsLb0WinnerInLb1(bracket, mkId, hostLb0Index = -1) {
  restoreLb0IfPrelimMerged(bracket);

  const prelimFeed = findPrelimLbFeed(bracket);
  if (!prelimFeed) return { changed: false, preservedConfirmed: lbHasAnyConfirmed(bracket) };

  const std = standardLb0Count(bracket);
  if (!std) return { changed: false, preservedConfirmed: lbHasAnyConfirmed(bracket) };

  const hostIdx =
    hostLb0Index < 0 ? std - 1 : Math.min(hostLb0Index, std - 1);
  const host = bracket.lb[0][hostIdx];
  const wbDrop = bracket.wb?.[1]?.[hostIdx];
  if (!host || !wbDrop) return { changed: false, preservedConfirmed: lbHasAnyConfirmed(bracket) };

  let changed = restoreLb1WbDropsIfPrelimStoleSlot(bracket, prelimFeed);

  const solo = findPrelimSoloLb0(bracket);
  if (solo) {
    bracket.lb[0] = bracket.lb[0].filter((m) => m.id !== solo.id);
    bracket.matches = (bracket.matches || []).filter((m) => m.id !== solo.id);
    bracket.lb[0].forEach((m, i) => {
      m.index = i;
    });
    changed = true;
  }

  if (!bracket.lb[1]) bracket.lb[1] = [];

  let seq = bracket.matches.length;
  const nextId = () => mkId(seq++);

  let bridge = findLokitoBridgeMatch(bracket, host, prelimFeed);
  if (!bridge) {
    bridge = createMatch(`lb-lokito-bridge-${hostIdx}`, "losers", 1, bracket.lb[1].length);
    bracket.lb[1].push(bridge);
    bracket.matches.push(bridge);
    changed = true;
  }
  if (!bridge.confirmed) {
    bridge.feedA = feed(host, "winner");
    bridge.feedB = prelimFeed;
    changed = true;
  }

  let drop = bracket.lb[1][hostIdx];
  if (!drop) {
    drop = createMatch(nextId(), "losers", 1, hostIdx);
    drop.index = hostIdx;
    while (bracket.lb[1].length < hostIdx) bracket.lb[1].push(null);
    if (bracket.lb[1].length === hostIdx) bracket.lb[1].push(drop);
    else bracket.lb[1][hostIdx] = drop;
    bracket.matches.push(drop);
    changed = true;
  }

  if (!drop.confirmed) {
    const wantA = feed(bridge, "winner");
    const wantB = feed(wbDrop, "loser");
    if (drop.feedA?.matchId !== wantA.matchId || drop.feedB?.matchId !== wantB.matchId) {
      drop.feedA = wantA;
      drop.feedB = wantB;
      drop.teamA = null;
      drop.teamB = null;
      changed = true;
    }
  }

  return { changed, preservedConfirmed: lbHasAnyConfirmed(bracket) };
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
  const wired = wireLokitoVsLb0WinnerInLb1(bracket, mkId, -1);
  if (wired.changed) return wired;

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
