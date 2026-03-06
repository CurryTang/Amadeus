// contracts/rust_traits.rs
// v0.2
// 说明：这是未来若迁移到更强类型后端时，建议优先稳定的过渡边界。

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
