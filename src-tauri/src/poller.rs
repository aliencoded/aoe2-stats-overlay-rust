use anyhow::Result;
use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::sync::Mutex;

use crate::companion::{
    fetch_current_match, fetch_latest_match_by_profile, fetch_many_matches, fetch_profile_by_steam_id,
    fetch_rank, search_profile_id_companion, CanonicalMatch, PlayerLite,
    Profile, RankArgs, RankInfo, RecentMatch,
};

const MATCH_FRESH_WINDOW_MS: i64 = 90 * 60 * 1000;
const MATCHES_PAGES: u32 = 2; // 2 × 20 = up to 40 raw matches per player
const SELF_TTL_MS: i64 = 60 * 60 * 1000;

#[derive(Debug, Clone, Serialize)]
pub struct MapStats {
    pub map: String,
    pub games: usize,
    pub wins: usize,
    pub winrate: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct CivTally {
    pub civ: String,
    pub games: i64,
    pub wins: i64,
    pub winrate: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct LastCiv {
    pub civ: Option<String>,
    pub won: Option<bool>,
    pub map: Option<String>,
    #[serde(rename = "ratingDiff")]
    pub rating_diff: Option<i64>,
    pub started: Option<String>,
}

// Raw match record forwarded to JS; all stats computed client-side per format.
#[derive(Debug, Clone, Serialize)]
pub struct PlayerMatch {
    #[serde(rename = "matchId", skip_serializing_if = "Option::is_none")]
    pub match_id: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub started: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub map: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub leaderboard: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub civ: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub won: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rating: Option<i64>,
    #[serde(rename = "ratingDiff", skip_serializing_if = "Option::is_none")]
    pub rating_diff: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct EnrichedPlayer {
    pub name: String,
    pub civ: Option<String>,
    pub rating: Option<i64>,
    #[serde(rename = "profileId")]
    pub profile_id: Option<String>,
    pub rank1v1: Option<RankInfo>,
    #[serde(rename = "rankTG")]
    pub rank_tg: Option<RankInfo>,
    // Overall aggregates computed server-side across all 40 fetched matches
    // (any format — companion's /api/matches ignores leaderboard filter).
    #[serde(rename = "topCivs")]
    pub top_civs: Vec<CivTally>,
    #[serde(rename = "lastCivs")]
    pub last_civs: Vec<LastCiv>,
    #[serde(rename = "ratingMin", skip_serializing_if = "Option::is_none")]
    pub rating_min: Option<i64>,
    #[serde(rename = "ratingMax", skip_serializing_if = "Option::is_none")]
    pub rating_max: Option<i64>,
    #[serde(rename = "ratingSamples", skip_serializing_if = "Option::is_none")]
    pub rating_samples: Option<usize>,
    #[serde(rename = "games24h", skip_serializing_if = "Option::is_none")]
    pub games_24h: Option<usize>,
    #[serde(rename = "games7d", skip_serializing_if = "Option::is_none")]
    pub games_7d: Option<usize>,
    #[serde(rename = "mapStats", skip_serializing_if = "Option::is_none")]
    pub map_stats: Option<MapStats>,
    // Raw matches (up to 40) — JS uses these to break down by leaderboard.
    pub matches: Vec<PlayerMatch>,
    pub team: Option<String>,
    #[serde(rename = "isSelf")]
    pub is_self: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct Snapshot {
    #[serde(rename = "inMatch")]
    pub in_match: bool,
    #[serde(rename = "matchId")]
    pub match_id: Option<Value>,
    #[serde(rename = "pseudoId")]
    pub pseudo_id: Option<String>,
    pub map: Option<String>,
    pub players: Vec<EnrichedPlayer>,
    pub self_: Option<EnrichedPlayer>,
    #[serde(rename = "fetchedAt")]
    pub fetched_at: String,
    pub cached: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

#[derive(Default)]
struct CacheState {
    self_profile: Option<(String, Profile)>,
    self_enriched: Option<(EnrichedPlayer, i64)>,
    match_cache: Option<MatchCache>,
}

struct MatchCache {
    key: String,
    match_id: Option<Value>,
    snapshot: Snapshot,
    fetched_at_ms: i64,
}

pub struct Poller {
    state: Arc<Mutex<CacheState>>,
    emit: Arc<dyn Fn(Value) + Send + Sync>,
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339()
}

fn tally_civs<F>(matches: &[RecentMatch], get_civ: F, top_n: usize) -> Vec<CivTally>
where
    F: Fn(&RecentMatch) -> Option<&str>,
{
    let mut counts: HashMap<String, (i64, i64)> = HashMap::new();
    for m in matches {
        if let Some(civ) = get_civ(m) {
            let e = counts.entry(civ.to_string()).or_insert((0, 0));
            e.0 += 1;
            if m.won == Some(true) {
                e.1 += 1;
            }
        }
    }
    let mut v: Vec<CivTally> = counts
        .into_iter()
        .map(|(civ, (g, w))| CivTally {
            civ,
            games: g,
            wins: w,
            winrate: if g > 0 { Some((100 * w / g) as i64) } else { None },
        })
        .collect();
    v.sort_by(|a, b| b.games.cmp(&a.games));
    v.truncate(top_n);
    v
}

fn pseudo_key(map: Option<&str>, a: &[PlayerLite], b: &[PlayerLite]) -> String {
    let mut names: Vec<String> = a
        .iter()
        .chain(b.iter())
        .map(|p| p.name.to_lowercase())
        .collect();
    names.sort();
    format!("live:{}:{}", map.unwrap_or("").to_lowercase(), names.join("|"))
}

fn started_ms(started: Option<&str>) -> i64 {
    started
        .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
        .map(|d| d.timestamp_millis())
        .unwrap_or(0)
}

fn is_finished(v: &Option<Value>) -> bool {
    matches!(v, Some(Value::Null) | None) == false && !matches!(v, Some(Value::Null))
}

impl Poller {
    pub fn new(emit: Arc<dyn Fn(Value) + Send + Sync>) -> Self {
        Self {
            state: Arc::new(Mutex::new(CacheState::default())),
            emit,
        }
    }

    pub async fn clear_match_cache(&self) {
        let mut s = self.state.lock().await;
        s.match_cache = None;
        tracing::info!(target: "cache", "[LOCAL] match cache cleared (manual)");
    }

    pub async fn clear_self_cache(&self) {
        let mut s = self.state.lock().await;
        s.self_enriched = None;
        tracing::info!(target: "cache", "[LOCAL] self cache cleared (manual)");
    }

    async fn get_self_profile(&self, steam_id: &str) -> Result<Option<Profile>> {
        {
            let s = self.state.lock().await;
            if let Some((sid, p)) = &s.self_profile {
                if sid == steam_id {
                    return Ok(Some(p.clone()));
                }
            }
        }
        let p = fetch_profile_by_steam_id(steam_id).await?;
        if let Some(p) = &p {
            let mut s = self.state.lock().await;
            s.self_profile = Some((steam_id.to_string(), p.clone()));
        }
        Ok(p)
    }

    async fn is_self(&self, player: &PlayerLite) -> bool {
        let s = self.state.lock().await;
        let Some((_, sp)) = &s.self_profile else { return false };
        if let (Some(pid), spid) = (&player.profile_id, &sp.profile_id) {
            if pid == spid {
                return true;
            }
        }
        player.name.to_lowercase() == sp.name.to_lowercase()
    }

    async fn enrich_player(&self, p: &PlayerLite, current_map: Option<&str>) -> EnrichedPlayer {
        let t0 = std::time::Instant::now();
        tracing::info!(target: "match", "[LOCAL] enrich → {}{}", p.name, p.civ.as_deref().map(|c| format!(" [{}]", c)).unwrap_or_default());
        let mut out = EnrichedPlayer {
            name: p.name.clone(),
            civ: p.civ.clone(),
            rating: p.rating,
            profile_id: None,
            rank1v1: None,
            rank_tg: None,
            top_civs: vec![],
            last_civs: vec![],
            rating_min: None,
            rating_max: None,
            rating_samples: None,
            games_24h: None,
            games_7d: None,
            map_stats: None,
            matches: vec![],
            team: None,
            is_self: false,
        };

        // Prefer profile_id from canonical match data — name-search hits the
        // wrong player constantly (fuzzy/partial match on companion side).
        // Only fall back to name search for nightbot fast-path entries that
        // have no profile_id.
        let pid: Option<String> = if let Some(pid) = &p.profile_id {
            Some(pid.clone())
        } else {
            match search_profile_id_companion(&p.name).await {
                Ok(opt) => opt,
                Err(e) => {
                    tracing::warn!(target: "match", "[LOCAL] profile-id search failed for '{}': {}", p.name, e);
                    None
                }
            }
        };
        out.profile_id = pid.clone();

        // Fetch both rank boards in parallel. Use profile_id when known,
        // otherwise search by original name (NOT a rank-search result name —
        // that cascades the wrong-player bug).
        let rank_args_1v1 = RankArgs {
            steam_id: None,
            profile_id: pid.as_deref(),
            search: if pid.is_some() { None } else { Some(p.name.as_str()) },
            leaderboard_id: 3,
        };
        let rank_args_tg = RankArgs {
            steam_id: None,
            profile_id: pid.as_deref(),
            search: if pid.is_some() { None } else { Some(p.name.as_str()) },
            leaderboard_id: 4,
        };
        let (r1_res, rt_res) = futures::future::join(fetch_rank(rank_args_1v1), fetch_rank(rank_args_tg)).await;
        let r1 = match r1_res {
            Ok(v) => Some(v),
            Err(e) => { tracing::warn!(target: "match", "[LOCAL] rank 1v1 failed for '{}': {}", p.name, e); None }
        };
        let rt = match rt_res {
            Ok(v) => Some(v),
            Err(e) => { tracing::warn!(target: "match", "[LOCAL] rank TG failed for '{}': {}", p.name, e); None }
        };

        // Adopt name from rank only when we did NOT have a profile_id
        // (i.e. name-search path) AND only as a courtesy display update.
        // With profile_id, trust the match-data name.
        if pid.is_none() {
            if let Some(r) = &r1 {
                if let Some(n) = &r.name {
                    out.name = n.clone();
                }
            }
        }
        out.rank1v1 = r1;
        out.rank_tg = rt;

        if let Some(pid) = pid {
            // Single fetch of up to 40 matches, any format. Compute overall
            // aggregates server-side (honest about being mixed format); also
            // expose raw matches for JS to break down per leaderboard.
            let raw = match fetch_many_matches(&pid, MATCHES_PAGES, None).await {
                Ok(v) => v,
                Err(e) => { tracing::warn!(target: "match", "[LOCAL] matches fetch failed for pid {}: {}", pid, e); vec![] }
            };

            out.top_civs = tally_civs(&raw, |m| m.civ.as_deref(), 5);
            out.last_civs = raw
                .iter()
                .take(5)
                .map(|m| LastCiv {
                    civ: m.civ.clone(),
                    won: m.won,
                    map: m.map.clone(),
                    rating_diff: m.rating_diff,
                    started: m.started.clone(),
                })
                .collect();

            // Rating range: only meaningful if all matches in window are same
            // format. Since they're mixed, this conflates 1v1 + TG ratings.
            // Still useful as a rough "how variable is their rating".
            let ratings: Vec<i64> = raw.iter().filter_map(|m| m.rating).collect();
            if !ratings.is_empty() {
                out.rating_min = ratings.iter().copied().min();
                out.rating_max = ratings.iter().copied().max();
                out.rating_samples = Some(ratings.len());
            }

            // Activity counts (deduped on matchId).
            let now = chrono::Utc::now().timestamp_millis();
            let day_ms = 24i64 * 60 * 60 * 1000;
            let mut seen_ids: std::collections::HashSet<String> = std::collections::HashSet::new();
            let mut g24 = 0usize;
            let mut g7 = 0usize;
            for m in raw.iter() {
                let id_key = match &m.match_id {
                    Some(Value::String(s)) => s.clone(),
                    Some(Value::Number(n)) => n.to_string(),
                    _ => m.started.clone().unwrap_or_default(),
                };
                if !seen_ids.insert(id_key) { continue; }
                let started_at = m.started
                    .as_deref()
                    .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
                    .map(|d| d.timestamp_millis())
                    .unwrap_or(0);
                if started_at == 0 { continue; }
                let age = now - started_at;
                if age <= day_ms { g24 += 1; }
                if age <= 7 * day_ms { g7 += 1; }
            }
            if g24 > 0 || g7 > 0 {
                out.games_24h = Some(g24);
                out.games_7d = Some(g7);
            }

            // Map record on current match's map (across all formats).
            if let Some(map_name) = current_map {
                let lc = map_name.to_lowercase();
                let mut games = 0usize;
                let mut wins = 0usize;
                for m in raw.iter() {
                    if m.map.as_deref().map(|s| s.to_lowercase()) == Some(lc.clone()) {
                        games += 1;
                        if m.won == Some(true) { wins += 1; }
                    }
                }
                if games > 0 {
                    out.map_stats = Some(MapStats {
                        map: map_name.to_string(),
                        games,
                        wins,
                        winrate: Some((100 * wins as i64) / games as i64),
                    });
                }
            }

            // Raw matches for client-side per-format breakdown.
            out.matches = raw.into_iter().map(|m| PlayerMatch {
                match_id: m.match_id,
                started: m.started,
                map: m.map,
                leaderboard: m.leaderboard.and_then(|v| match v {
                    Value::String(s) => Some(s),
                    Value::Number(n) => Some(n.to_string()),
                    _ => None,
                }),
                civ: m.civ,
                won: m.won,
                rating: m.rating,
                rating_diff: m.rating_diff,
                duration: m.duration,
            }).collect();
        }

        tracing::info!(
            target: "match",
            "[LOCAL] enrich ← {} · 1v1={:?} · matches={} ({}ms)",
            out.name,
            out.rank1v1.as_ref().and_then(|r| r.rating),
            out.matches.len(),
            t0.elapsed().as_millis()
        );
        out
    }

    async fn enrich_self(&self, current_map: Option<&str>) -> Option<EnrichedPlayer> {
        {
            let s = self.state.lock().await;
            if let Some((snap, ts)) = &s.self_enriched {
                if now_ms() - ts < SELF_TTL_MS {
                    return Some(snap.clone());
                }
            }
        }
        let sp = {
            let s = self.state.lock().await;
            s.self_profile.as_ref().map(|(_, p)| p.clone())
        }?;
        let stub = PlayerLite {
            name: sp.name.clone(),
            rating: None,
            civ: None,
            profile_id: Some(sp.profile_id.clone()),
            won: None,
            team: None,
        };
        let snap = self.enrich_player(&stub, current_map).await;
        {
            let mut s = self.state.lock().await;
            s.self_enriched = Some((snap.clone(), now_ms()));
        }
        Some(snap)
    }

    pub async fn resolve_match_snapshot(&self, steam_id: &str) -> Result<Snapshot> {
        tracing::info!(target: "match", "[LOCAL] resolve · steamId=…{}", &steam_id[steam_id.len().saturating_sub(6)..]);
        let self_p = match self.get_self_profile(steam_id).await {
            Ok(Some(p)) => p,
            Ok(None) => {
                return Ok(Snapshot {
                    in_match: false,
                    match_id: None,
                    pseudo_id: None,
                    map: None,
                    players: vec![],
                    self_: None,
                    fetched_at: now_iso(),
                    cached: false,
                    reason: Some("no self profile".into()),
                });
            }
            Err(e) => {
                tracing::warn!("[LOCAL] self lookup fail: {}", e);
                return Ok(Snapshot {
                    in_match: false,
                    match_id: None,
                    pseudo_id: None,
                    map: None,
                    players: vec![],
                    self_: None,
                    fetched_at: now_iso(),
                    cached: false,
                    reason: Some("no self profile".into()),
                });
            }
        };
        tracing::info!(target: "match", "[LOCAL] self · {} (profileId={})", self_p.name, self_p.profile_id);

        let canonical_fut = fetch_latest_match_by_profile(&self_p.profile_id);
        let live_fut = fetch_current_match(Some(steam_id), None);
        let (canonical_r, live_r) = futures::future::join(canonical_fut, live_fut).await;
        let canonical = match canonical_r {
            Ok(v) => v,
            Err(e) => { tracing::warn!(target: "match", "[LOCAL] canonical match lookup failed: {}", e); None }
        };
        let live = match live_r {
            Ok(v) => Some(v),
            Err(e) => { tracing::warn!(target: "match", "[LOCAL] nightbot current-match lookup failed: {}", e); None }
        };

        let mut chosen: Option<CanonicalMatch> = None;
        let mut using_fast_path = false;

        if let Some(c) = &canonical {
            let started = started_ms(c.started.as_deref());
            let age_ms = now_ms() - started;
            let is_fresh = age_ms < MATCH_FRESH_WINDOW_MS;
            let is_live = matches!(c.finished, None | Some(Value::Null));
            tracing::info!(
                target: "match",
                "[LOCAL] canonical · finished={} · ageMin={} · live={} · fresh={}",
                if is_live { "no" } else { "yes" },
                age_ms / 60000,
                is_live,
                is_fresh
            );
            if is_live || is_fresh {
                chosen = Some(c.clone());
            }
        }

        if let Some(l) = &live {
            if !l.team_a.is_empty() || !l.team_b.is_empty() {
                let live_pseudo = pseudo_key(l.map.as_deref(), &l.team_a, &l.team_b);
                let canon_pseudo = canonical
                    .as_ref()
                    .map(|c| pseudo_key(c.map.as_deref(), &c.team_a, &c.team_b));
                if chosen.is_none() || Some(live_pseudo.clone()) != canon_pseudo {
                    tracing::info!(target: "match", "[LOCAL] fast-path · nightbot has live match (canonical lagging)");
                    chosen = Some(CanonicalMatch {
                        match_id: None,
                        started: Some(now_iso()),
                        finished: Some(Value::Null),
                        map: l.map.clone(),
                        leaderboard: None,
                        leaderboard_id: None,
                        team_a: l.team_a.clone(),
                        team_b: l.team_b.clone(),
                    });
                    using_fast_path = true;
                }
            }
        }

        let Some(m) = chosen else {
            {
                let mut s = self.state.lock().await;
                if s.match_cache.is_some() {
                    tracing::info!(target: "cache", "[LOCAL] clear (no match from either source)");
                    s.match_cache = None;
                }
            }
            return Ok(Snapshot {
                in_match: false,
                match_id: None,
                pseudo_id: None,
                map: None,
                players: vec![],
                self_: None,
                fetched_at: now_iso(),
                cached: false,
                reason: Some("no match".into()),
            });
        };

        let is_live = matches!(m.finished, None | Some(Value::Null));
        let pseudo = pseudo_key(m.map.as_deref(), &m.team_a, &m.team_b);
        let all: Vec<PlayerLite> = m
            .team_a
            .iter()
            .chain(m.team_b.iter())
            .cloned()
            .collect();
        if all.is_empty() {
            let mut s = self.state.lock().await;
            s.match_cache = None;
            return Ok(Snapshot {
                in_match: false,
                match_id: None,
                pseudo_id: None,
                map: None,
                players: vec![],
                self_: None,
                fetched_at: now_iso(),
                cached: false,
                reason: Some("empty teams".into()),
            });
        }

        let cache_key = m
            .match_id
            .as_ref()
            .and_then(|v| match v {
                Value::String(s) => Some(s.clone()),
                Value::Number(n) => Some(n.to_string()),
                _ => None,
            })
            .unwrap_or_else(|| pseudo.clone());

        {
            let mut s = self.state.lock().await;
            if let Some(c) = &s.match_cache {
                if c.key == cache_key {
                    tracing::info!(target: "cache", "[LOCAL] HIT · key={} · skip enrich", cache_key);
                    let mut snap = c.snapshot.clone();
                    snap.cached = true;
                    snap.in_match = is_live;
                    return Ok(snap);
                }
                if !using_fast_path
                    && m.match_id.is_some()
                    && c.match_id.is_none()
                    && c.snapshot.pseudo_id.as_deref() == Some(pseudo.as_str())
                {
                    tracing::info!(target: "cache", "[LOCAL] promote · pseudo → matchId");
                    let mut snap = c.snapshot.clone();
                    snap.match_id = m.match_id.clone();
                    snap.cached = true;
                    snap.in_match = is_live;
                    let new_cache = MatchCache {
                        key: cache_key.clone(),
                        match_id: m.match_id.clone(),
                        snapshot: snap.clone(),
                        fetched_at_ms: c.fetched_at_ms,
                    };
                    s.match_cache = Some(new_cache);
                    return Ok(snap);
                }
            }
        }
        tracing::info!(target: "cache", "[LOCAL] MISS · key={} · enriching {} players", cache_key, all.len());

        let team_a_names: std::collections::HashSet<String> =
            m.team_a.iter().map(|p| p.name.clone()).collect();

        let skeleton: Vec<EnrichedPlayer> = {
            let mut v = vec![];
            for p in &all {
                v.push(EnrichedPlayer {
                    name: p.name.clone(),
                    civ: p.civ.clone(),
                    rating: p.rating,
                    profile_id: p.profile_id.clone(),
                    rank1v1: None,
                    rank_tg: None,
                    top_civs: vec![],
                    last_civs: vec![],
                    rating_min: None,
                    rating_max: None,
                    rating_samples: None,
                    games_24h: None,
                    games_7d: None,
                    map_stats: None,
                    matches: vec![],
                    team: Some(if team_a_names.contains(&p.name) { "A".into() } else { "B".into() }),
                    is_self: self.is_self(p).await,
                });
            }
            v
        };

        (self.emit)(serde_json::json!({
            "stage": "skeleton",
            "matchId": m.match_id,
            "pseudoId": pseudo,
            "map": m.map,
            "inMatch": is_live,
            "players": skeleton,
        }));

        let t_start = std::time::Instant::now();

        // Determine self/team per player up front (cheap).
        let mut metas: Vec<(bool, String)> = Vec::with_capacity(all.len());
        for p in &all {
            let is_self = self.is_self(p).await;
            let team = if team_a_names.contains(&p.name) { "A".into() } else { "B".into() };
            metas.push((is_self, team));
        }

        // Fan out enrich for all players concurrently. Each future emits
        // its own `match-partial player` event as soon as it finishes.
        let tasks = all.iter().zip(metas.iter()).map(|(p, (is_self, team))| {
            let p = p.clone();
            let team = team.clone();
            let is_self = *is_self;
            let map_name = m.map.clone();
            async move {
                let mn = map_name.as_deref();
                let mut e = if is_self {
                    let cached = self.enrich_self(mn).await;
                    if let Some(mut c) = cached {
                        c.civ = p.civ.clone();
                        c.rating = p.rating;
                        c
                    } else {
                        self.enrich_player(&p, mn).await
                    }
                } else {
                    self.enrich_player(&p, mn).await
                };
                e.is_self = is_self;
                e.team = Some(team);
                (self.emit)(serde_json::json!({ "stage": "player", "player": e }));
                e
            }
        });
        let enriched: Vec<EnrichedPlayer> = futures::future::join_all(tasks).await;
        let self_snap = enriched.iter().find(|e| e.is_self).cloned();
        tracing::info!(target: "match", "[LOCAL] enriched {} players in {}ms (parallel)", enriched.len(), t_start.elapsed().as_millis());

        let snapshot = Snapshot {
            in_match: is_live,
            match_id: m.match_id.clone(),
            pseudo_id: Some(pseudo),
            map: m.map.clone(),
            players: enriched,
            self_: self_snap,
            fetched_at: now_iso(),
            cached: false,
            reason: None,
        };

        {
            let mut s = self.state.lock().await;
            s.match_cache = Some(MatchCache {
                key: cache_key.clone(),
                match_id: m.match_id.clone(),
                snapshot: snapshot.clone(),
                fetched_at_ms: now_ms(),
            });
        }
        tracing::info!(target: "cache", "[LOCAL] STORE · key={}{}", cache_key, if using_fast_path { " (fast-path)" } else { "" });

        Ok(snapshot)
    }
}

// Silence unused warning for helper not currently referenced.
#[allow(dead_code)]
fn _unused() { let _ = is_finished(&None); }
