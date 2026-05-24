use anyhow::{anyhow, Result};
use once_cell::sync::Lazy;
use reqwest::header::{HeaderMap, HeaderValue, ACCEPT, ACCEPT_ENCODING, ACCEPT_LANGUAGE, USER_AGENT};
use reqwest::Client;
use serde::de::DeserializeOwned;
use std::time::{Duration, Instant};

const UA: &str = concat!(
    "aoe2-stats-overlay/",
    env!("CARGO_PKG_VERSION"),
    " (+https://github.com/aliencoded/aoe2-stats-mod)"
);

static CLIENT: Lazy<Client> = Lazy::new(|| {
    Client::builder()
        .timeout(Duration::from_secs(15))
        .gzip(true)
        .brotli(true)
        .deflate(true)
        .build()
        .expect("reqwest client")
});

pub async fn get_json<T: DeserializeOwned>(url: &str) -> Result<T> {
    let t0 = Instant::now();
    tracing::info!(target: "http", "GET {}", url);
    let r = CLIENT
        .get(url)
        .header(USER_AGENT, UA)
        .header(ACCEPT, "application/json")
        .send()
        .await?;
    let status = r.status();
    let dt = t0.elapsed().as_millis();
    if !status.is_success() {
        tracing::error!(target: "http", "  ↳ {} ({}ms)", status, dt);
        return Err(anyhow!("GET {} -> {}", url, status));
    }
    let v: T = r.json().await?;
    tracing::info!(target: "http", "  ↳ {} json ({}ms)", status, dt);
    Ok(v)
}

pub async fn get_text(url: &str) -> Result<String> {
    let t0 = Instant::now();
    tracing::info!(target: "http", "GET {}", url);
    let mut headers = HeaderMap::new();
    headers.insert(USER_AGENT, HeaderValue::from_static(UA));
    headers.insert(
        ACCEPT,
        HeaderValue::from_static(
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        ),
    );
    headers.insert(ACCEPT_LANGUAGE, HeaderValue::from_static("en-US,en;q=0.9"));
    headers.insert(ACCEPT_ENCODING, HeaderValue::from_static("gzip, deflate, br"));
    headers.insert("Sec-Fetch-Dest", HeaderValue::from_static("document"));
    headers.insert("Sec-Fetch-Mode", HeaderValue::from_static("navigate"));
    headers.insert("Sec-Fetch-Site", HeaderValue::from_static("none"));
    headers.insert("Upgrade-Insecure-Requests", HeaderValue::from_static("1"));

    let r = CLIENT.get(url).headers(headers).send().await?;
    let status = r.status();
    let dt = t0.elapsed().as_millis();
    if !status.is_success() {
        tracing::error!(target: "http", "  ↳ {} ({}ms)", status, dt);
        return Err(anyhow!("GET {} -> {}", url, status));
    }
    let t = r.text().await?;
    tracing::info!(target: "http", "  ↳ {} {}b ({}ms)", status, t.len(), dt);
    Ok(t)
}
