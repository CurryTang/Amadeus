import EmptyState from '../ui/EmptyState';
import SkeletonCards from '../ui/SkeletonCards';

function VibeHomeView({
  loading,
  projects,
  projectStats,
  onCreateProject,
  onSelectProject,
  submitting,
  skills,
  onSyncSkills,
  syncingSkills,
  showSkillMenu = true,
}) {
  return (
    <div className="vibe-home">
      <div className="vibe-home-head">
        <h3>Project Workspace</h3>
        <p>Select an existing project to enter its workspace. New project opens in this view until you click it.</p>
      </div>

      {loading && projects.length === 0 ? (
        <SkeletonCards count={4} />
      ) : (
        <div className="vibe-project-grid" role="list" aria-label="Projects">
          <button
            type="button"
            className="vibe-project-card vibe-project-create"
            onClick={onCreateProject}
            disabled={submitting}
            aria-label="Add new project"
          >
            <span className="vibe-project-plus">+</span>
            <strong>Add New Project</strong>
            <span>Create project details after click</span>
          </button>

          {projects.map((project) => {
            const stats = projectStats.get(project.id) || { ideas: 0, queued: 0 };
            return (
              <button
                key={project.id}
                type="button"
                className="vibe-project-card"
                onClick={() => onSelectProject(project.id)}
              >
                <div className="vibe-project-card-top">
                  <h3>{project.name}</h3>
                  <code>{project.id}</code>
                </div>
                <p>{project.description || 'No description provided yet.'}</p>
                <div className="vibe-project-metrics">
                  <span>{stats.ideas} ideas</span>
                  <span>{stats.queued} queued</span>
                  <span>{project.locationType === 'ssh' ? 'SSH' : 'Local'}</span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {!loading && projects.length === 0 && (
        <EmptyState
          className="vibe-compact-empty"
          title="No projects yet"
          hint="Click 'Add New Project' to create your first workspace."
          actionLabel="Add New Project"
          onAction={onCreateProject}
        />
      )}

      {showSkillMenu && (
        <article className="vibe-card vibe-skill-card">
          <div className="vibe-skill-header">
            <h3>Merged Skills ({skills.length})</h3>
            <button
              type="button"
              className="vibe-secondary-btn"
              onClick={onSyncSkills}
              disabled={syncingSkills || submitting}
            >
              {syncingSkills ? 'Syncing…' : 'Sync Remote Skills'}
            </button>
          </div>
          <div className="vibe-skill-list">
            {skills.length === 0 ? (
              <EmptyState
                className="vibe-compact-empty"
                title="No skills found"
                hint="Sync from object storage or add local skills under `skills/*/SKILL.md`."
              />
            ) : (
              skills.map((skill) => (
                <span
                  key={skill.id}
                  className="vibe-skill-chip"
                  title={`${skill.source || 'unknown'}${skill.version ? ` · v${skill.version}` : ''}`}
                >
                  {skill.name}
                </span>
              ))
            )}
          </div>
        </article>
      )}
    </div>
  );
}

export default VibeHomeView;
