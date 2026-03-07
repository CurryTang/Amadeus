use researchops_local_daemon::{
    build_task_catalog,
    build_runtime_summary,
    task_catalog_version,
    OPTIONAL_BRIDGE_TASK_TYPES,
};

#[test]
fn runtime_summary_marks_bridge_ready_when_all_bridge_tasks_are_advertised() {
    let summary = build_runtime_summary(&[
        "project.checkPath",
        "project.ensurePath",
        "project.ensureGit",
        "bridge.fetchNodeContext",
        "bridge.fetchContextPack",
        "bridge.submitNodeRun",
        "bridge.fetchRunReport",
        "bridge.submitRunNote",
    ]);

    assert_eq!(summary.task_catalog_version, "v0");
    assert!(summary.supports_local_bridge_workflow);
    assert!(summary.missing_bridge_task_types.is_empty());
}

#[test]
fn runtime_summary_reports_missing_bridge_tasks_when_only_project_tasks_exist() {
    let summary = build_runtime_summary(&[
        "project.checkPath",
        "project.ensurePath",
        "project.ensureGit",
    ]);

    assert!(!summary.supports_local_bridge_workflow);
    assert_eq!(summary.missing_bridge_task_types, OPTIONAL_BRIDGE_TASK_TYPES);
}

#[test]
fn task_catalog_version_matches_the_current_v0_contract() {
    assert_eq!(task_catalog_version(), "v0");
}

#[test]
fn task_catalog_exposes_built_in_and_bridge_task_descriptors() {
    let catalog = build_task_catalog();

    assert_eq!(catalog.version, "v0");
    assert!(catalog
        .tasks
        .iter()
        .any(|task| task.task_type == "project.checkPath" && task.handler_mode == "builtin"));
    assert!(catalog
        .tasks
        .iter()
        .any(|task| task.task_type == "bridge.submitNodeRun" && task.handler_mode == "builtin-http-proxy"));
    assert!(catalog
        .tasks
        .iter()
        .any(|task| task.task_type == "bridge.captureWorkspaceSnapshot" && task.handler_mode == "builtin"));
}
