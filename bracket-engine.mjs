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
 * Cruce de repechaje con rival en la misma ronda (feed apunta a otro match del mismo round).
 */
export function findIntraRoundLbFeedIssues(bracket) {
  const issues = [];
  for (const round of bracket.lb || []) {
    if (!round?.length) continue;
    const ids = new Set(round.map((m) => m.id));
    for (const m of round) {
      for (const f of [m.feedA, m.feedB]) {
        if (f && ids.has(f.matchId)) {
          issues.push({ round: m.round, matchId: m.id, feedsFrom: f.matchId });
        }
      }
    }
  }
  return issues;
}

/** Fuentes de lado A para una bajada WB→LB (ganador previo o play-in preliminar). */
function buildLbDropSideA(prev, options = {}) {
  const feeds = [];
  if (options.survivorMatch) feeds.push(feed(options.survivorMatch, "winner"));
  const playInHost = options.playInHostIdx ?? -1;
  const playInFeed = options.playInFeed || null;
  for (let i = 0; i < (prev?.length || 0); i++) {
    if (playInHost >= 0 && playInFeed && i === playInHost) {
      feeds.push(playInFeed);
    } else {
      feeds.push(feed(prev[i], "winner"));
    }
  }
  if (playInHost < 0 && options.extraPrelimFeed) {
    feeds.push(options.extraPrelimFeed);
  }
  return feeds;
}

/** Cuántos clasificados LB sobran antes de la primera bajada WB (necesitan play-in). */
export function computeLbPlayInNeeded(lb0MatchCount, prelimChampSlots, wbDropCount) {
  return Math.max(0, lb0MatchCount + prelimChampSlots - wbDropCount);
}

/** Cruces WB preliminares en el cuadro principal: uno por cada equipo que sobra. */
export function planWinnersPrelimDraw(teamCount, targetSize) {
  const excess = Math.max(0, teamCount - targetSize);
  const prelimPairCount = excess;
  const directCount = targetSize - prelimPairCount;
  const prelimTeamCount = prelimPairCount * 2;
  return { excess, prelimPairCount, directCount, prelimTeamCount };
}

/**
 * Lista de feeds de perdedores que entran al repechaje antes de LB R1:
 * cada perdedor WB prelim se empareja en reducción con un perdedor de octavos.
 */
export function buildLbEntrantFeeds(wbPrelimMatches, wbRound0) {
  const feeds = [];
  const prelimCount = wbPrelimMatches?.length || 0;
  const octavos = wbRound0 || [];
  for (let i = 0; i < prelimCount; i++) {
    feeds.push(feed(wbPrelimMatches[i], "loser"));
    if (octavos[i]) feeds.push(feed(octavos[i], "loser"));
  }
  for (let i = prelimCount; i < octavos.length; i++) {
    feeds.push(feed(octavos[i], "loser"));
  }
  return feeds;
}

export function buildLb0FromFeeds(survivorFeeds, mkId) {
  const lb0 = [];
  const matches = [];
  for (let i = 0; i < survivorFeeds.length; i += 2) {
    if (!survivorFeeds[i + 1]) break;
    const match = createMatch(mkId(), "losers", 0, lb0.length);
    match.feedA = survivorFeeds[i];
    match.feedB = survivorFeeds[i + 1];
    matches.push(match);
    lb0.push(match);
  }
  return { lb0, matches };
}

/**
 * Reduce el pool de repechaje (p. ej. 10→8) con preliminares LB reales, sin BYE.
 * targetSurvivors = plazas en LB R1 (pares de octavos = wb[0].length).
 */
export function buildLbPoolReduction(entrantFeeds, targetSurvivors, mkId, createPrelimMatch) {
  const eliminations = Math.max(0, entrantFeeds.length - targetSurvivors);
  const loserRounds = [];
  const prelimMatches = [];

  if (eliminations <= 0) {
    const built = buildLb0FromFeeds(entrantFeeds, mkId);
    return {
      loserRounds,
      survivorFeeds: entrantFeeds,
      lb0: built.lb0,
      matches: built.matches,
    };
  }

  const round = [];
  for (let i = 0; i < eliminations; i++) {
    const m = createPrelimMatch
      ? createPrelimMatch(i, loserRounds.length)
      : createMatch(mkId(), "preliminary-lb", loserRounds.length, i);
    m.feedA = entrantFeeds[i * 2];
    m.feedB = entrantFeeds[i * 2 + 1];
    m.bestOf = 5;
    round.push(m);
    prelimMatches.push(m);
  }
  loserRounds.push(round);

  const bypass = entrantFeeds.slice(eliminations * 2);
  const winners = round.map((m) => feed(m, "winner"));
  const survivorFeeds = [...bypass, ...winners];
  const built = buildLb0FromFeeds(survivorFeeds, mkId);

  return {
    loserRounds,
    survivorFeeds,
    lb0: built.lb0,
    matches: [...prelimMatches, ...built.matches],
  };
}

/** Sustituye lb[0] y devuelve rondas prelim LB para preliminary.loserRounds. */
export function setupLosersPoolForWbPrelims(bracket, wbPrelimMatches, mkId, createPrelimMatch) {
  const wb = bracket.wb;
  if (!wb?.[0]?.length || !wbPrelimMatches?.length) {
    return { loserRounds: [], changed: false };
  }

  const entrantFeeds = buildLbEntrantFeeds(wbPrelimMatches, wb[0]);
  const targetSurvivors = wb[0].length;
  const built = buildLbPoolReduction(entrantFeeds, targetSurvivors, mkId, createPrelimMatch);

  const oldLb0Ids = new Set((bracket.lb?.[0] || []).map((m) => m.id));
  bracket.matches = (bracket.matches || []).filter((m) => !oldLb0Ids.has(m.id));
  if (!bracket.lb) bracket.lb = [];
  bracket.lb[0] = built.lb0;
  bracket.matches.push(...built.matches);
  bracket.lbPrelimRounds = [];
  bracket._prelimLbFeed = null;
  bracket._lbPlayInHostIdx = -1;
  bracket._lbPoolReduction = true;

  rebuildLbFromDrop(bracket, mkId);

  return { loserRounds: built.loserRounds, changed: true };
}

/**
 * Si hay más clasificados LB que bajadas WB, reduce con rondas preliminares internas
 * (emparejando ganadores LB entre sí) hasta poder enfrentarlos con perdedores WB.
 */
export function buildLbEntrantPrelimRounds(lbFeeds, targetCount, startLbR, mkId) {
  const rounds = [];
  const matches = [];
  let entrants = [...lbFeeds];
  let lbR = startLbR;
  let roundIndex = 0;

  while (entrants.length > targetCount && entrants.length > 1) {
    const eliminations = entrants.length - targetCount;
    const round = [];
    const nextEntrants = [];
    let i = 0;
    for (let e = 0; e < eliminations && i + 1 < entrants.length; e++, i += 2) {
      const match = createMatch(mkId(), "preliminary-lb", roundIndex, round.length);
      match.feedA = entrants[i];
      match.feedB = entrants[i + 1];
      round.push(match);
      matches.push(match);
      nextEntrants.push(feed(match, "winner"));
    }
    for (; i < entrants.length; i++) {
      nextEntrants.push(entrants[i]);
    }
    if (round.length) rounds.push(round);
    entrants = nextEntrants;
    lbR++;
    roundIndex++;
  }

  return { rounds, matches, survivors: entrants, nextLbR: lbR };
}

/** Ronda LB de bajadas: ganadores previos vs perdedores WB (sin BYE fantasma). */
export function buildLbDropRound(prev, wbRound, lbR, mkId, options = {}) {
  const insertedRounds = [];
  const matches = [];
  const wbSlots = wbRound || [];
  const targetWb = wbSlots.length;
  let lbFeeds = buildLbDropSideA(prev, options);

  if (targetWb > 0 && lbFeeds.length > targetWb) {
    const prelim = buildLbEntrantPrelimRounds(lbFeeds, targetWb, 0, mkId);
    insertedRounds.push(...prelim.rounds);
    matches.push(...prelim.matches);
    lbFeeds = prelim.survivors;
  }

  const round = [];
  const slotCount = targetWb > 0 ? Math.min(lbFeeds.length, targetWb) : lbFeeds.length;
  for (let slot = 0; slot < slotCount; slot++) {
    const match = createMatch(mkId(), "losers", lbR, slot);
    match.feedA = lbFeeds[slot];
    if (slot < wbSlots.length) {
      match.feedB = feed(wbSlots[slot], "loser");
    } else {
      break;
    }
    round.push(match);
    matches.push(match);
  }

  return {
    round,
    insertedRounds,
    matches,
    nextLbR: round.length ? lbR + 1 : lbR,
  };
}

/**
 * Puente preliminar en ronda propia (LB R2) y bajada WB completa en la siguiente (LB R3).
 * Todos los perdedores WB entran en la misma ronda de bajada; ninguno salta rondas.
 */
export function buildPrelimBridgeLayout(lb0, wbRound, hostIdx, prelimFeed, mkId) {
  const matches = [];
  if (!lb0?.length || !wbRound?.length || !prelimFeed) {
    return { lb1: [], lb2: [], matches, startLbR: 1, startWbDrop: 1 };
  }

  const host = Math.min(Math.max(hostIdx, 0), lb0.length - 1);
  const bridge = createMatch(mkId(), "losers", 1, 0);
  bridge.feedA = feed(lb0[host], "winner");
  bridge.feedB = prelimFeed;
  bridge.isPrelimBridge = true;
  const lb1 = [bridge];
  matches.push(bridge);

  const lb2 = [];
  for (let i = 0; i < wbRound.length; i++) {
    const match = createMatch(mkId(), "losers", 2, i);
    match.feedA = i === host ? feed(bridge, "winner") : feed(lb0[i], "winner");
    match.feedB = feed(wbRound[i], "loser");
    lb2.push(match);
    matches.push(match);
  }

  return { lb1, lb2, matches, startLbR: 3, startWbDrop: 2 };
}

/** @deprecated Usar buildPrelimBridgeLayout */
export function buildLb1WithPrelimBridge(lb0, wbRound, hostIdx, prelimFeed, mkId) {
  const layout = buildPrelimBridgeLayout(lb0, wbRound, hostIdx, prelimFeed, mkId);
  return { round: layout.lb2, matches: layout.matches };
}

/** Empareja ganadores de la ronda anterior; impar pasa como survivor (sin BYE). */
export function buildLbConsolidationRound(prevRound, lbR, mkId) {
  const round = [];
  const matches = [];
  if (!prevRound?.length || prevRound.length === 1) {
    return { round, matches, survivor: prevRound?.[0] || null };
  }
  const pairCount = Math.floor(prevRound.length / 2);
  for (let i = 0; i < pairCount; i++) {
    const match = createMatch(mkId(), "losers", lbR, i);
    match.feedA = feed(prevRound[i * 2], "winner");
    match.feedB = feed(prevRound[i * 2 + 1], "winner");
    matches.push(match);
    round.push(match);
  }
  const survivor =
    prevRound.length % 2 === 1 ? prevRound[prevRound.length - 1] : null;
  return { round, matches, survivor };
}

/**
 * A partir de lb[0] ya definido, genera lb[1..] y devuelve cruces nuevos.
 * options.bridgeHostIndex + bridge en lb[bridgeRoundIndex]: bajada WB usa ganador del puente.
 */
export function extendLbRoundsFrom(wb, lb, startLbR, startWbDrop, mkId, options = {}) {
  const matches = [];
  const lbPrelimRounds = [];
  let lbR = startLbR;
  let wbDrop = startWbDrop;
  let pendingSurvivor = options.survivorMatch || null;

  while (lbR < 20 && wbDrop < wb.length) {
    const prev = lb[lbR - 1];
    if (!prev?.length && !pendingSurvivor) break;

    const drop = buildLbDropRound(prev, wb[wbDrop], lbR, mkId, {
      survivorMatch: pendingSurvivor,
      playInFeed: options.playInFeed && wbDrop === 1 ? options.playInFeed : null,
      playInHostIdx: wbDrop === 1 ? options.playInHostIdx ?? -1 : -1,
      extraPrelimFeed: options.extraPrelimFeed && wbDrop === 1 ? options.extraPrelimFeed : null,
    });
    pendingSurvivor = null;

    for (const pr of drop.insertedRounds || []) {
      lbPrelimRounds.push(pr);
    }
    if (drop.round.length) {
      drop.round.forEach((m) => {
        m.round = lbR;
      });
      lb[lbR] = drop.round;
      lbR = drop.nextLbR;
    } else if (!drop.insertedRounds?.length) {
      break;
    }
    matches.push(...drop.matches);
    wbDrop++;

    const prev2 = lb[lbR - 1];
    if (!prev2?.length) continue;
    if (prev2.length === 1) continue;

    const cons = buildLbConsolidationRound(prev2, lbR, mkId);
    if (cons.round.length) {
      lb[lbR] = cons.round;
      matches.push(...cons.matches);
      lbR++;
    }
    if (cons.survivor) pendingSurvivor = cons.survivor;
  }

  return { matches, lbR, survivor: pendingSurvivor, lbPrelimRounds };
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

  const usePoolReduction = bracket._lbPoolReduction === true;
  const prelimFeed = usePoolReduction
    ? null
    : bracket._prelimLbFeed || findPrelimLbFeed(bracket);

  if (prelimFeed) {
    const solo = findPrelimSoloLb0(bracket);
    if (solo) {
      bracket.lb[0] = bracket.lb[0].filter((m) => m.id !== solo.id);
      bracket.matches = (bracket.matches || []).filter((m) => m.id !== solo.id);
      bracket.lb[0].forEach((m, i) => {
        m.index = i;
      });
    }
  }

  bracket.lbPrelimRounds = [];
  const lb0Count = bracket.lb[0].length;
  const wb1Count = wb[1]?.length || 0;
  const hasPrelim = !!prelimFeed && !usePoolReduction;
  const playInNeeded =
    hasPrelim && computeLbPlayInNeeded(lb0Count, 1, wb1Count) > 0;
  const playInHostIdx =
    usePoolReduction || !playInNeeded
      ? -1
      : bracket._lbPlayInHostIdx >= 0
        ? bracket._lbPlayInHostIdx
        : lb0Count - 1;
  const ext = extendLbRoundsFrom(wb, bracket.lb, 1, 1, nextId, {
    playInFeed: !usePoolReduction && playInHostIdx >= 0 && prelimFeed ? prelimFeed : null,
    playInHostIdx: usePoolReduction ? -1 : playInHostIdx,
    extraPrelimFeed:
      !usePoolReduction && playInHostIdx < 0 && prelimFeed ? prelimFeed : null,
  });
  bracket.lbPrelimRounds = [];
  if (playInHostIdx >= 0) bracket._lbPlayInHostIdx = playInHostIdx;
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
 * LB: puente en ronda propia; bajada WB en la siguiente (sin esperar cruce de la misma ronda).
 */
export function wireLokitoVsLb0WinnerInLb1(bracket, mkId, hostLb0Index = -1) {
  restoreLb0IfPrelimMerged(bracket);

  const prelimFeed = findPrelimLbFeed(bracket);
  if (!prelimFeed) return { changed: false, preservedConfirmed: lbHasAnyConfirmed(bracket) };

  const std = standardLb0Count(bracket);
  if (!std) return { changed: false, preservedConfirmed: lbHasAnyConfirmed(bracket) };

  const hostIdx =
    hostLb0Index < 0 ? std - 1 : Math.min(hostLb0Index, std - 1);
  const hasConfirmed = lbHasAnyConfirmed(bracket);

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

  if (hasConfirmed) {
    return wireLokitoPreserveConfirmed(bracket, mkId, hostIdx, prelimFeed, changed);
  }

  const playInNeeded = computeLbPlayInNeeded(std, 1, bracket.wb?.[1]?.length || 0);
  bracket._lbPlayInHostIdx = playInNeeded > 0 ? hostIdx : -1;
  bracket._prelimLbFeed = prelimFeed;
  if (rebuildLbFromDrop(bracket, mkId)) changed = true;

  return { changed, preservedConfirmed: false };
}

/** Si ya hay LB jugado: solo enlaza sin reordenar rondas confirmadas. */
function wireLokitoPreserveConfirmed(bracket, mkId, hostIdx, prelimFeed, changed) {
  const host = bracket.lb[0][hostIdx];
  const wbDrop = bracket.wb?.[1]?.[hostIdx];
  if (!host || !wbDrop) return { changed, preservedConfirmed: true };

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

  let drop = bracket.lb[1]?.[hostIdx];
  if (!drop) {
    drop = createMatch(nextId(), "losers", 1, hostIdx);
    drop.index = hostIdx;
    if (!bracket.lb[1]) bracket.lb[1] = [];
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

  return { changed, preservedConfirmed: true };
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
    if (repairLbByeGhosts(bracket, nextId).changed) return { changed: true, preservedConfirmed: false };
    if (repairLbProgressionFromLb0(bracket, nextId).changed) {
      return { changed: true, preservedConfirmed: false };
    }
    return { changed: false, preservedConfirmed: false };
  }

  if (repairOrphanPrelimMinimal(bracket, nextId, orphans)) changed = true;
  return { changed, preservedConfirmed: true };
}

/** Perdedores WB sin cruce de repechaje asignado. */
export function findOrphanWbLosers(bracket) {
  const orphans = [];
  for (const round of bracket.wb || []) {
    for (const m of round) {
      const hasDest = (bracket.matches || []).some(
        (x) =>
          (x.feedA?.matchId === m.id && x.feedA?.slot === "loser") ||
          (x.feedB?.matchId === m.id && x.feedB?.slot === "loser")
      );
      if (!hasDest) orphans.push(m);
    }
  }
  return orphans;
}

/**
 * Repara perdedores WB huérfanos (p. ej. cuartos en hueco preliminar).
 * Sin tocar cruces LB ya confirmados.
 */
export function repairOrphanWbLosersToLb(bracket, mkId) {
  const orphans = findOrphanWbLosers(bracket);
  if (!orphans.length) return { changed: false };

  let changed = false;
  for (const wbM of orphans) {
    if (wbM.confirmed) continue;
    const drop = (bracket.matches || []).find(
      (m) =>
        m.bracket === "losers" &&
        !m.confirmed &&
        m.feedA?.slot === "winner" &&
        (!m.feedB || m.teamB?.startsWith?.("bye-"))
    );
    if (!drop) continue;
    drop.feedB = feed(wbM, "loser");
    drop.teamB = null;
    changed = true;
  }
  return { changed };
}

/**
 * Reconstruye repechaje desde lb[0] con progresión ronda a ronda (sin BYE fantasma).
 * Solo si aún no hay cruces LB confirmados.
 */
export function repairLbProgressionFromLb0(bracket, mkId) {
  if (lbHasAnyConfirmed(bracket)) {
    return { changed: false, preservedConfirmed: true };
  }
  const prelimFeed = findPrelimLbFeed(bracket);
  const solo = findPrelimSoloLb0(bracket);
  if (solo) {
    bracket.lb[0] = bracket.lb[0].filter((m) => m.id !== solo.id);
    bracket.matches = (bracket.matches || []).filter((m) => m.id !== solo.id);
    bracket.lb[0].forEach((m, i) => {
      m.index = i;
    });
  }
  if (prelimFeed) {
    bracket._prelimLbFeed = prelimFeed;
    const std = standardLb0Count(bracket);
    const playInNeeded = computeLbPlayInNeeded(std, 1, bracket.wb?.[1]?.length || 0);
    bracket._lbPlayInHostIdx =
      bracket._lbPlayInHostIdx >= 0
        ? bracket._lbPlayInHostIdx
        : playInNeeded > 0
          ? std - 1
          : -1;
  }
  const changed = rebuildLbFromDrop(bracket, mkId);
  return { changed, preservedConfirmed: false };
}

/**
 * Quita rondas preliminares del motor mal generadas y reconstruye play-in en preliminary.
 */
export function repairBrokenLbPrelimRounds(bracket, preliminary, mkId) {
  if (lbHasAnyConfirmed(bracket)) {
    return { changed: false, preservedConfirmed: true };
  }
  let changed = false;

  if (bracket.lbPrelimRounds?.length) {
    const ids = new Set();
    for (const round of bracket.lbPrelimRounds) {
      for (const m of round || []) ids.add(m.id);
    }
    bracket.matches = (bracket.matches || []).filter((m) => !ids.has(m.id));
    bracket.lbPrelimRounds = [];
    changed = true;
  }

  if (preliminary?.loserRounds?.length > 1) {
    const lbMainIds = new Set();
    for (let r = 1; r < (bracket.lb?.length || 0); r++) {
      for (const m of bracket.lb[r] || []) lbMainIds.add(m.id);
    }
    const filtered = preliminary.loserRounds.filter((round) => {
      const m = round[0];
      if (!m) return true;
      const badA = m.feedA?.slot === "winner" && lbMainIds.has(m.feedA.matchId);
      const badB = m.feedB?.slot === "winner" && lbMainIds.has(m.feedB.matchId);
      return !(badA || badB);
    });
    if (filtered.length !== preliminary.loserRounds.length) {
      preliminary.loserRounds = filtered;
      changed = true;
    }
  }

  if (!changed) return { changed: false, preservedConfirmed: false };

  const lastRound = preliminary?.loserRounds?.[preliminary.loserRounds.length - 1];
  if (lastRound?.[0]) {
    bracket._prelimLbFeed = feed(lastRound[0], "winner");
  }
  rebuildLbFromDrop(bracket, mkId);
  return { changed: true, preservedConfirmed: false };
}

/** Elimina cruces LB con BYE fantasma no confirmados y reconstruye cola. */
export function repairLbByeGhosts(bracket, mkId) {
  if (lbHasAnyConfirmed(bracket)) return { changed: false, preservedConfirmed: true };
  const ghosts = (bracket.matches || []).filter(
    (m) =>
      m.bracket === "losers" &&
      !m.confirmed &&
      (m.teamB?.startsWith?.("bye-") || m.teamA?.startsWith?.("bye-"))
  );
  if (!ghosts.length) return { changed: false, preservedConfirmed: false };
  const ghostIds = new Set(ghosts.map((m) => m.id));
  bracket.matches = bracket.matches.filter((m) => !ghostIds.has(m.id));
  for (let r = 0; r < (bracket.lb?.length || 0); r++) {
    bracket.lb[r] = (bracket.lb[r] || []).filter((m) => !ghostIds.has(m.id));
  }
  return repairLbProgressionFromLb0(bracket, mkId);
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
