use anyhow::Result;
use researchops_local_daemon::{
    build_runtime_summary,
    BUILT_IN_TASK_TYPES,
    OPTIONAL_BRIDGE_TASK_TYPES,
};

fn main() -> Result<()> {
    let mut task_types = BUILT_IN_TASK_TYPES
        .iter()
        .map(|item| *item)
        .collect::<Vec<_>>();

    let enable_bridge = std::env::var("RESEARCHOPS_DAEMON_ENABLE_BRIDGE_TASKS")
        .map(|value| matches!(value.trim().to_ascii_lowercase().as_str(), "1" | "true" | "yes" | "on"))
        .unwrap_or(true);
    if enable_bridge {
        task_types.extend(OPTIONAL_BRIDGE_TASK_TYPES.iter().copied());
    }

    let summary = build_runtime_summary(&task_types);
    println!("{}", serde_json::to_string_pretty(&summary)?);
    Ok(())
}
