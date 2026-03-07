use serde::Serialize;

pub const TASK_CATALOG_VERSION: &str = "v0";

pub const BUILT_IN_TASK_TYPES: [&str; 3] = [
    "project.checkPath",
    "project.ensurePath",
    "project.ensureGit",
];

pub const OPTIONAL_BRIDGE_TASK_TYPES: [&str; 5] = [
    "bridge.fetchNodeContext",
    "bridge.fetchContextPack",
    "bridge.submitNodeRun",
    "bridge.fetchRunReport",
    "bridge.submitRunNote",
];

pub trait TreePlanStore: Send + Sync {
    fn read_plan(&self, project_id: &str) -> anyhow::Result<String>;
    fn write_plan(&self, project_id: &str, plan_yaml: &str) -> anyhow::Result<()>;
}

pub trait TreeStateStore: Send + Sync {
    fn read_state(&self, project_id: &str) -> anyhow::Result<String>;
    fn write_state(&self, project_id: &str, state_json: &str) -> anyhow::Result<()>;
}

pub trait RunStore: Send + Sync {
    fn create_run(&self, run_json: &str) -> anyhow::Result<String>;
    fn get_run(&self, run_id: &str) -> anyhow::Result<Option<String>>;
    fn update_run_status(&self, run_id: &str, status: &str, message: Option<&str>) -> anyhow::Result<()>;
    fn append_run_event(&self, run_id: &str, event_json: &str) -> anyhow::Result<()>;
}

pub trait ContextPackBuilder: Send + Sync {
    fn build_knowledge_context(&self, project_id: &str, run_id: Option<&str>) -> anyhow::Result<String>;
    fn build_routed_run_context(&self, run_id: &str) -> anyhow::Result<String>;
}

pub trait ObservedSessionIndexer: Send + Sync {
    fn list_observed_sessions(&self, project_id: &str) -> anyhow::Result<Vec<String>>;
    fn refresh_observed_session(&self, project_id: &str, observed_session_id: &str) -> anyhow::Result<String>;
}

pub trait RunReportBuilder: Send + Sync {
    fn build_run_report(&self, run_id: &str) -> anyhow::Result<String>;
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct RuntimeSummary {
    pub task_catalog_version: &'static str,
    pub supported_task_types: Vec<String>,
    pub supports_local_bridge_workflow: bool,
    pub missing_bridge_task_types: Vec<String>,
}

pub fn task_catalog_version() -> &'static str {
    TASK_CATALOG_VERSION
}

pub fn build_runtime_summary(task_types: &[&str]) -> RuntimeSummary {
    let supported_task_types = normalize_task_types(task_types);
    let missing_bridge_task_types = OPTIONAL_BRIDGE_TASK_TYPES
        .iter()
        .filter(|task_type| !supported_task_types.iter().any(|item| item == **task_type))
        .map(|task_type| (*task_type).to_string())
        .collect::<Vec<_>>();

    RuntimeSummary {
        task_catalog_version: TASK_CATALOG_VERSION,
        supported_task_types,
        supports_local_bridge_workflow: missing_bridge_task_types.is_empty(),
        missing_bridge_task_types,
    }
}

fn normalize_task_types(task_types: &[&str]) -> Vec<String> {
    let mut normalized = Vec::<String>::new();
    for task_type in task_types {
        let trimmed = task_type.trim();
        if trimmed.is_empty() || normalized.iter().any(|item| item == trimmed) {
            continue;
        }
        normalized.push(trimmed.to_string());
    }
    normalized
}
