/**
 * Lógica compartida: fusión local/nube y utilidades de cuadro (admin + index + tests).
 */
export function createTournamentLib(options = {}) {
  const maxPlayersPerTeam = options.maxPlayersPerTeam ?? 6;

  function hasBracketStructure(p) {
    return !!(
      p?.bracket?.wb?.length ||
      p?.bracket?.matches?.length ||
      p?.preliminary?.rounds?.length
    );
  }

  /** Cuadro visible en web pública: estructura real y no marcado como borrador. */
  function isPubliclyListable(p) {
    if (!p) return false;
    if (countConfirmedMatchesInPayload(p) > 0) return true;
    if (p.drawn === false) return false;
    if (hasBracketStructure(p)) return true;
    return !!p.drawInfo?.drawnAt && hasBracketStructure(p);
  }

  function hasBracketData(p) {
    return isPubliclyListable(p);
  }

  function totalPlayersInPayload(p) {
    return (p?.teams || []).reduce((n, t) => n + (t.players?.length || 0), 0);
  }

  function countConfirmedMatchesInPayload(p) {
    if (!p) return 0;
    let n = 0;
    const visit = (m) => {
      if (m?.confirmed) n++;
    };
    const walkRound = (round) => {
      if (!Array.isArray(round)) return;
      round.forEach(visit);
    };
    const walkRounds = (rounds) => {
      if (!Array.isArray(rounds)) return;
      rounds.forEach(walkRound);
    };
    const b = p.bracket;
    if (b) {
      walkRounds(b.wb);
      walkRounds(b.lb);
      if (b.grand) visit(b.grand);
      if (Array.isArray(b.matches)) b.matches.forEach(visit);
    }
    const pre = p.preliminary;
    if (pre) {
      walkRounds(pre.rounds);
      walkRounds(pre.loserRounds);
    }
    return n;
  }

  function payloadScore(p) {
    if (!p) return -1;
    let s = 0;
    if (hasBracketData(p)) s += 1e9;
    if (p.drawn) s += 1e8;
    s += totalPlayersInPayload(p) * 1e5;
    s += countConfirmedMatchesInPayload(p) * 1e6;
    s += Date.parse(p.savedAt || p.drawInfo?.drawnAt || 0) || 0;
    return s;
  }

  function payloadTime(p) {
    return Date.parse(p?.savedAt || p?.drawInfo?.drawnAt || 0) || 0;
  }

  /** Huella de equipos/jugadores para detectar copias locales desactualizadas. */
  function rosterSignature(p) {
    if (!p?.teams?.length) return "";
    return p.teams
      .map((t) => {
        const players = (t.players || []).map((x) => String(x || "").trim()).join("\t");
        return `${t.id}\t${String(t.name || "").trim()}\t${players}`;
      })
      .sort()
      .join("\n");
  }

  /**
   * Elige la copia correcta al abrir admin en otro PC.
   * Evita que un savedAt inflado en localStorage gane sobre Firestore/servidor.
   */
  function resolveAuthoritativePayload(local, cloud, options = {}) {
    if (!local && !cloud) return null;
    if (!local) return cloud;
    if (!cloud) return local;

    const prefer = options.prefer === "local" ? "local" : "cloud";
    const lTime = payloadTime(local);
    const cTime = payloadTime(cloud);
    const rosterDiff = rosterSignature(local) !== rosterSignature(cloud);

    if (rosterDiff && lTime > cTime && hasBracketData(cloud)) {
      const lConfirmed = countConfirmedMatchesInPayload(local);
      const cConfirmed = countConfirmedMatchesInPayload(cloud);
      if (cConfirmed >= lConfirmed) {
        return {
          ...cloud,
          teams: cloneTeams(cloud.teams),
          teamIdCounter: Math.max(local.teamIdCounter || 0, cloud.teamIdCounter || 0),
          savedAt: cloud.savedAt || local.savedAt,
        };
      }
    }

    if (lTime > cTime) return mergePayload(local, cloud, { prefer: "local" });
    if (cTime > lTime) return mergePayload(local, cloud, { prefer: "cloud" });
    return mergePayload(local, cloud, { prefer });
  }

  function pickPayload(local, cloud, options = {}) {
    const prefer = options.prefer === "cloud" ? "cloud" : "local";
    const lTime = payloadTime(local);
    const cTime = payloadTime(cloud);
    if (lTime > cTime) return local;
    if (cTime > lTime) return cloud;

    const lScore = payloadScore(local);
    const cScore = payloadScore(cloud);
    if (lScore > cScore) return local;
    if (cScore > lScore) return cloud;
    return prefer === "cloud" ? cloud : local;
  }

  function cloneTeams(teams) {
    return (teams || []).map((t) => ({ ...t, players: [...(t.players || [])] }));
  }

  function mergeTeamPlayers(localPlayers, cloudPlayers) {
    const a = Array.isArray(localPlayers) ? localPlayers : [];
    const b = Array.isArray(cloudPlayers) ? cloudPlayers : [];
    const len = Math.max(a.length, b.length);
    const out = [];
    for (let i = 0; i < len; i++) {
      const lv = a[i] != null ? String(a[i]) : "";
      const cv = b[i] != null ? String(b[i]) : "";
      out.push(lv.trim() ? lv : cv);
    }
    return out.slice(0, maxPlayersPerTeam);
  }

  function mergeTeams(localTeams, cloudTeams) {
    const map = new Map();
    for (const t of localTeams || []) {
      map.set(t.id, { ...t, players: [...(t.players || [])] });
    }
    for (const ct of cloudTeams || []) {
      if (!map.has(ct.id)) {
        map.set(ct.id, { ...ct, players: [...(ct.players || [])] });
        continue;
      }
      const lt = map.get(ct.id);
      lt.players = mergeTeamPlayers(lt.players, ct.players);
      if (!String(lt.name || "").trim() && String(ct.name || "").trim()) {
        lt.name = ct.name;
      }
    }
    return Array.from(map.values());
  }

  /** Combina local + nube sin perder cuadro ni jugadores extra */
  function mergePayload(local, cloud, options = {}) {
    if (!local && !cloud) return null;
    if (!local) return cloud;
    if (!cloud) return local;

    const base = pickPayload(local, cloud, options);
    const teamPick = pickPayload(local, cloud, options);
    const teamOther = teamPick === local ? cloud : local;
    const sameTeamMoment = payloadTime(local) === payloadTime(cloud);
    const merged = {
      ...base,
      // Si una fuente es más nueva, sus equipos/jugadores mandan. Mezclar siempre
      // reintroducía jugadores viejos desde localStorage tras hibernación del sitio.
      teams: sameTeamMoment && options.prefer !== "cloud"
        ? mergeTeams(teamPick.teams, teamOther.teams)
        : cloneTeams(teamPick.teams),
      teamIdCounter: Math.max(local.teamIdCounter || 0, cloud.teamIdCounter || 0),
    };

    if (hasBracketData(local) && !hasBracketData(cloud)) {
      merged.bracket = local.bracket;
      merged.preliminary = local.preliminary;
      merged.drawInfo = local.drawInfo;
      merged.drawn = local.drawn;
      merged.roundFormats = local.roundFormats || cloud.roundFormats;
    } else if (hasBracketData(cloud) && !hasBracketData(local)) {
      merged.bracket = cloud.bracket;
      merged.preliminary = cloud.preliminary;
      merged.drawInfo = cloud.drawInfo;
      merged.drawn = cloud.drawn;
      merged.roundFormats = cloud.roundFormats || local.roundFormats;
    } else if (hasBracketData(local) && hasBracketData(cloud)) {
      const pick = pickPayload(local, cloud, options);
      const other = pick === local ? cloud : local;
      merged.bracket = pick.bracket;
      merged.preliminary = pick.preliminary;
      merged.drawInfo = pick.drawInfo;
      merged.drawn = pick.drawn;
      merged.roundFormats = pick.roundFormats || other.roundFormats;
    }

    const t = Math.max(
      Date.parse(local.savedAt || 0) || 0,
      Date.parse(cloud.savedAt || 0) || 0
    );
    merged.savedAt = t ? new Date(t).toISOString() : new Date().toISOString();
    return merged;
  }

  function choosePayload(local, cloud) {
    return mergePayload(local, cloud);
  }

  /** Solo bloquea si el equipo viene de un feed y aún no hay ganador (no si ya hay teamA/B). */
  function feedBlocksSide(match, side, resolveFeed) {
    const feed = side === "A" ? match.feedA : match.feedB;
    const directId = side === "A" ? match.teamA : match.teamB;
    if (!feed) return false;
    if (directId) return false;
    return !resolveFeed(feed);
  }

  return {
    hasBracketStructure,
    isPubliclyListable,
    hasBracketData,
    totalPlayersInPayload,
    countConfirmedMatchesInPayload,
    payloadScore,
    payloadTime,
    rosterSignature,
    resolveAuthoritativePayload,
    mergeTeamPlayers,
    mergeTeams,
    mergePayload,
    choosePayload,
    feedBlocksSide,
  };
}
