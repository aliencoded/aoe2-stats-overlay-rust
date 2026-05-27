use std::path::PathBuf;
use tracing_appender::non_blocking::WorkerGuard;
use tracing_appender::rolling::{RollingFileAppender, Rotation};
use tracing_subscriber::layer::SubscriberExt;
use tracing_subscriber::util::SubscriberInitExt;
use tracing_subscriber::{fmt, EnvFilter};

pub struct LogState {
    pub file_path: PathBuf,
    _guard: WorkerGuard,
}

pub fn init(app_data_dir: PathBuf) -> anyhow::Result<LogState> {
    let dir = app_data_dir.join("logs");
    std::fs::create_dir_all(&dir)?;
    let file_path = dir.join("app.log");

    let appender = RollingFileAppender::builder()
        .rotation(Rotation::NEVER)
        .filename_prefix("app")
        .filename_suffix("log")
        .max_log_files(2)
        .build(&dir)?;
    let (nb_file, guard) = tracing_appender::non_blocking(appender);

    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("info,aoe2_stats_overlay_lib=debug"));

    let console_layer = fmt::layer()
        .with_target(false)
        .with_ansi(true)
        .with_writer(std::io::stdout);
    let file_layer = fmt::layer()
        .with_target(false)
        .with_ansi(false)
        .with_writer(nb_file);

    tracing_subscriber::registry()
        .with(filter)
        .with(console_layer)
        .with(file_layer)
        .init();

    tracing::info!(pid = std::process::id(), "[LOCAL] boot");
    Ok(LogState { file_path, _guard: guard })
}
