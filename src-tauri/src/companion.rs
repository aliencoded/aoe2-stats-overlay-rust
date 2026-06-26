use anyhow::{anyhow, Result};
use once_cell::sync::Lazy;
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::http::{get_json, get_text};

const BASE: &str = "https://data.aoe2companion.com/api";

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct RankInfo {
    pub raw: Option<String>,
    pub name: Option<String>,
    pub rating: Option<i64>,
    pub rank: Option<i64>,
    pub games: Option<i64>,
    pub winrate: Option<i64>,
    pub streak: Option<i64>,
    pub drops: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PlayerLite {
    pub name: String,
    pub rating: Option<i64>,
    pub civ: Option<String>,
    #[serde(rename = "profileId", skip_serializing_if = "Option::is_none")]
    pub profile_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub won: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub team: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct LiveMatch {
    pub raw: Option<String>,
    pub map: Option<String>,
    #[serde(rename = "teamA")]
    pub team_a: Vec<PlayerLite>,
    #[serde(rename = "teamB")]
    pub team_b: Vec<PlayerLite>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CanonicalMatch {
    #[serde(rename = "matchId")]
    pub match_id: Option<Value>,
    pub started: Option<String>,
    pub finished: Option<Value>,
    pub map: Option<String>,
    pub leaderboard: Option<Value>,
    #[serde(rename = "leaderboardId", skip_serializing_if = "Option::is_none")]
    pub leaderboard_id: Option<Value>,
    #[serde(rename = "teamA")]
    pub team_a: Vec<PlayerLite>,
    #[serde(rename = "teamB")]
    pub team_b: Vec<PlayerLite>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct RecentMatch {
    #[serde(rename = "matchId")]
    pub match_id: Option<Value>,
    pub started: Option<String>,
    pub map: Option<String>,
    pub leaderboard: Option<Value>,
    pub civ: Option<String>,
    pub won: Option<bool>,
    pub rating: Option<i64>,
    #[serde(rename = "ratingDiff")]
    pub rating_diff: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration: Option<i64>,
}

#[derive(Debug, Clone)]
pub struct RankArgs<'a> {
    pub steam_id: Option<&'a str>,
    pub profile_id: Option<&'a str>,
    pub search: Option<&'a str>,
    pub leaderboard_id: i32,
}

fn unquote(s: &str) -> String {
    let s = s.trim();
    if s.starts_with('"') && s.ends_with('"') && s.len() >= 2 {
        if let Ok(v) = serde_json::from_str::<String>(s) {
            return v;
        }
        return s[1..s.len() - 1].to_string();
    }
    s.to_string()
}

static RE_RANK_HEAD: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"^(?:\S+\s+)?(.+?)\s+\((\d+)\)\s+Rank\s+#(\d+)").unwrap());
static RE_GAMES: Lazy<Regex> = Lazy::new(|| Regex::new(r"played\s+(\d+)\s+games").unwrap());
static RE_WIN: Lazy<Regex> = Lazy::new(|| Regex::new(r"(\d+)%\s+winrate").unwrap());
static RE_STREAK: Lazy<Regex> = Lazy::new(|| Regex::new(r"(-?\d+)\s+streak").unwrap());
static RE_DROPS: Lazy<Regex> = Lazy::new(|| Regex::new(r"(\d+)\s+drops").unwrap());

pub fn parse_rank(text: &str) -> RankInfo {
    let mut r = RankInfo {
        raw: Some(text.to_string()),
        ..Default::default()
    };
    if let Some(c) = RE_RANK_HEAD.captures(text) {
        r.name = Some(c[1].trim().to_string());
        r.rating = c[2].parse().ok();
        r.rank = c[3].parse().ok();
    }
    if let Some(c) = RE_GAMES.captures(text) {
        r.games = c[1].parse().ok();
    }
    if let Some(c) = RE_WIN.captures(text) {
        r.winrate = c[1].parse().ok();
    }
    if let Some(c) = RE_STREAK.captures(text) {
        r.streak = c[1].parse().ok();
    }
    if let Some(c) = RE_DROPS.captures(text) {
        r.drops = c[1].parse().ok();
    }
    r
}

static RE_MAP: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)playing on\s+(.+?)$").unwrap());
static RE_VS: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)\s+vs\s+").unwrap());
static RE_PLAYING_ON: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)\s+playing on\s+.*$").unwrap());
static RE_PLAYER: Lazy<Regex> = Lazy::new(|| {
    // Name class is Unicode-aware: \p{L}\p{N}\p{M} accept non-Latin names (e.g.
    // CJK "惠惠神獸"). Common gamertag punctuation (~!@#$%^&*=:;,'?) is included
    // so names like "~斑驳~" parse — without these the surrounding symbols break
    // the match and the player is dropped. Emoji/flag prefixes are \p{So} so they
    // stay excluded and get skipped. Civ stays ASCII (nightbot returns English civ
    // names). Without this, a symbol-wrapped or non-Latin opponent name fails to
    // parse → pseudo cache key has only self → "skip enrich" → blank card.
    Regex::new(r"([\p{L}\p{N}\p{M}_.\-\[\]|()~!@#$%^&*=:;,'? ]{2,32}?)\s*\((\d{3,4})\)\s*as\s+([A-Za-z' ]+?)(?:\s*\+|\s*$)")
        .unwrap()
});

fn parse_players(s: &str) -> Vec<PlayerLite> {
    RE_PLAYER
        .captures_iter(s)
        .map(|c| PlayerLite {
            name: c[1].trim().to_string(),
            rating: c[2].parse().ok(),
            civ: Some(c[3].trim().to_string()),
            ..Default::default()
        })
        .collect()
}

pub fn parse_match(text: &str) -> LiveMatch {
    let mut m = LiveMatch {
        raw: Some(text.to_string()),
        ..Default::default()
    };
    if let Some(c) = RE_MAP.captures(text) {
        m.map = Some(c[1].trim().to_string());
    }
    let parts: Vec<&str> = RE_VS.splitn(text, 2).collect();
    let a_str = parts.first().copied().unwrap_or("");
    let b_raw = parts.get(1).copied().unwrap_or("");
    let b_str = RE_PLAYING_ON.replace(b_raw, "").to_string();
    m.team_a = parse_players(a_str);
    m.team_b = parse_players(&b_str);
    m
}

pub async fn fetch_rank(a: RankArgs<'_>) -> Result<RankInfo> {
    let mut q = vec![("leaderboard_id".to_string(), a.leaderboard_id.to_string())];
    if let Some(s) = a.steam_id {
        q.push(("steam_id".to_string(), s.to_string()));
    } else if let Some(p) = a.profile_id {
        q.push(("profile_id".to_string(), p.to_string()));
    } else if let Some(s) = a.search {
        q.push(("search".to_string(), s.to_string()));
    } else {
        return Err(anyhow!("fetch_rank requires steam_id, profile_id, or search"));
    }
    let qs: String = q
        .iter()
        .map(|(k, v)| format!("{}={}", k, urlencoding::encode(v)))
        .collect::<Vec<_>>()
        .join("&");
    let url = format!("{}/nightbot/rank?{}", BASE, qs);
    let text = unquote(&get_text(&url).await?);
    Ok(parse_rank(&text))
}

pub async fn fetch_current_match(steam_id: Option<&str>, profile_id: Option<&str>) -> Result<LiveMatch> {
    let mut q = vec![];
    if let Some(s) = steam_id {
        q.push(format!("steam_id={}", urlencoding::encode(s)));
    } else if let Some(p) = profile_id {
        q.push(format!("profile_id={}", urlencoding::encode(p)));
    } else {
        return Err(anyhow!("fetch_current_match requires steam_id or profile_id"));
    }
    let url = format!("{}/nightbot/match?{}", BASE, q.join("&"));
    let text = unquote(&get_text(&url).await?);
    Ok(parse_match(&text))
}

fn s_or_num(v: &Value) -> Option<String> {
    match v {
        Value::String(s) => Some(s.clone()),
        Value::Number(n) => Some(n.to_string()),
        _ => None,
    }
}

pub async fn fetch_latest_match_by_profile(profile_id: &str) -> Result<Option<CanonicalMatch>> {
    let url = format!("{}/matches?profile_ids={}&limit=1", BASE, profile_id);
    let data: Value = get_json(&url).await?;
    let matches = data.get("matches").and_then(|m| m.as_array()).cloned().unwrap_or_default();
    let m = match matches.into_iter().next() {
        Some(m) => m,
        None => return Ok(None),
    };

    let mut team_map: std::collections::BTreeMap<i64, Vec<PlayerLite>> = Default::default();
    if let Some(teams) = m.get("teams").and_then(|t| t.as_array()) {
        for t in teams {
            let team_id = t.get("teamId").and_then(|v| v.as_i64()).unwrap_or(0);
            if let Some(players) = t.get("players").and_then(|p| p.as_array()) {
                for p in players {
                    let key = p.get("team").and_then(|v| v.as_i64()).unwrap_or(team_id);
                    let pl = PlayerLite {
                        name: p.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                        rating: p.get("rating").and_then(|v| v.as_i64()),
                        civ: p
                            .get("civName")
                            .and_then(|v| v.as_str())
                            .or_else(|| p.get("civ").and_then(|v| v.as_str()))
                            .map(|s| s.to_string()),
                        profile_id: p.get("profileId").and_then(s_or_num),
                        won: p.get("won").and_then(|v| v.as_bool()),
                        team: Some(key),
                    };
                    team_map.entry(key).or_default().push(pl);
                }
            }
        }
    }
    let keys: Vec<i64> = team_map.keys().copied().collect();
    let team_a = keys.first().and_then(|k| team_map.get(k)).cloned().unwrap_or_default();
    let team_b = keys.get(1).and_then(|k| team_map.get(k)).cloned().unwrap_or_default();

    Ok(Some(CanonicalMatch {
        match_id: m.get("matchId").cloned(),
        started: m.get("started").and_then(|v| v.as_str()).map(|s| s.to_string()),
        finished: m.get("finished").cloned(),
        map: m
            .get("mapName")
            .and_then(|v| v.as_str())
            .or_else(|| m.get("map").and_then(|v| v.as_str()))
            .map(|s| s.to_string()),
        leaderboard: m
            .get("leaderboardName")
            .cloned()
            .or_else(|| m.get("leaderboard").cloned()),
        leaderboard_id: m.get("leaderboardId").cloned(),
        team_a,
        team_b,
    }))
}

/// Total ranked players on a leaderboard (e.g. "rm_1v1", "rm_team"), used to
/// turn a rank number into a percentile. Fetches a 1-row page just for `total`.
pub async fn fetch_leaderboard_total(id: &str) -> Result<i64> {
    let url = format!("{}/leaderboards/{}", BASE, id);
    let data: Value = get_json(&url).await?;
    data.get("total")
        .and_then(|v| v.as_i64())
        .ok_or_else(|| anyhow!("no total in leaderboard {}", id))
}

fn extract_duration(m: &Value) -> Option<i64> {
    if let Some(d) = m.get("duration").and_then(|v| v.as_i64()) {
        return Some(d);
    }
    let started = m.get("started").and_then(|v| v.as_str())?;
    let finished = m.get("finished").and_then(|v| v.as_str())?;
    let s = chrono::DateTime::parse_from_rfc3339(started).ok()?;
    let f = chrono::DateTime::parse_from_rfc3339(finished).ok()?;
    Some((f.timestamp() - s.timestamp()).max(0))
}

pub async fn fetch_many_matches(
    profile_id: &str,
    pages: u32,
    leaderboard_id: Option<&str>,
) -> Result<Vec<RecentMatch>> {
    let mut out = vec![];
    for page in 1..=pages {
        let mut url = format!("{}/matches?profile_ids={}&page={}", BASE, profile_id, page);
        if let Some(lb) = leaderboard_id {
            url.push_str(&format!("&leaderboard_id={}", urlencoding::encode(lb)));
        }
        let data: Value = match get_json(&url).await {
            Ok(v) => v,
            Err(_) => break,
        };
        let rows = data.get("matches").and_then(|m| m.as_array()).cloned().unwrap_or_default();
        let n = rows.len();
        for m in &rows {
            if let Some(teams) = m.get("teams").and_then(|t| t.as_array()) {
                for t in teams {
                    if let Some(players) = t.get("players").and_then(|p| p.as_array()) {
                        for p in players {
                            let pid = p.get("profileId").and_then(s_or_num);
                            if pid.as_deref() != Some(profile_id) {
                                continue;
                            }
                            out.push(RecentMatch {
                                match_id: m.get("matchId").cloned(),
                                started: m.get("started").and_then(|v| v.as_str()).map(|s| s.to_string()),
                                map: m
                                    .get("mapName")
                                    .and_then(|v| v.as_str())
                                    .or_else(|| m.get("map").and_then(|v| v.as_str()))
                                    .map(|s| s.to_string()),
                                leaderboard: m
                                    .get("leaderboardId")
                                    .cloned()
                                    .or_else(|| m.get("leaderboard").cloned()),
                                civ: p.get("civ").and_then(|v| v.as_str()).map(|s| s.to_string()),
                                won: p.get("won").and_then(|v| v.as_bool()),
                                rating: p.get("rating").and_then(|v| v.as_i64()),
                                rating_diff: p.get("ratingDiff").and_then(|v| v.as_i64()),
                                duration: extract_duration(m),
                            });
                        }
                    }
                }
            }
        }
        if n < 20 {
            break;
        }
    }
    Ok(out)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Profile {
    #[serde(rename = "profileId")]
    pub profile_id: String,
    pub name: String,
}

pub async fn fetch_profile_by_steam_id(steam_id: &str) -> Result<Option<Profile>> {
    let url = format!("{}/profiles?steam_id={}", BASE, steam_id);
    let data: Value = get_json(&url).await?;
    let p = data
        .get("profiles")
        .and_then(|v| v.as_array())
        .and_then(|a| a.first())
        .cloned();
    Ok(p.and_then(|p| {
        let pid = p.get("profileId").and_then(s_or_num)?;
        let name = p.get("name").and_then(|v| v.as_str())?.to_string();
        Some(Profile { profile_id: pid, name })
    }))
}

pub async fn search_profile_id_companion(name: &str) -> Result<Option<String>> {
    let url = format!("{}/profiles?search={}", BASE, urlencoding::encode(name));
    let data: Value = match get_json::<Value>(&url).await {
        Ok(v) => v,
        Err(_) => return Ok(None),
    };
    let rows = data.get("profiles").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    if rows.is_empty() {
        return Ok(None);
    }
    let lc = name.to_lowercase();
    let mut pool: Vec<Value> = rows
        .iter()
        .filter(|r| r.get("name").and_then(|v| v.as_str()).map(|s| s.to_lowercase()) == Some(lc.clone()))
        .cloned()
        .collect();
    if pool.is_empty() {
        pool = rows;
    }
    pool.sort_by(|a, b| {
        let av = a.get("verified").and_then(|v| v.as_bool()).unwrap_or(false);
        let bv = b.get("verified").and_then(|v| v.as_bool()).unwrap_or(false);
        if av != bv {
            return if av { std::cmp::Ordering::Less } else { std::cmp::Ordering::Greater };
        }
        let ag = a.get("games").and_then(|v| v.as_i64()).unwrap_or(0);
        let bg = b.get("games").and_then(|v| v.as_i64()).unwrap_or(0);
        bg.cmp(&ag)
    });
    Ok(pool.first().and_then(|p| p.get("profileId").and_then(s_or_num)))
}
