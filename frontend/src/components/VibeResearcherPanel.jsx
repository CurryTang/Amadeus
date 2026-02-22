import { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';

function VibeResearcherPanel({ apiUrl, getAuthHeaders }) {
  const [projects, setProjects] = useState([]);
  const [ideas, setIdeas] = useState([]);
  const [queue, setQueue] = useState([]);
  const [skills, setSkills] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [lastRefreshedAt, setLastRefreshedAt] = useState('');

  const [projectName, setProjectName] = useState('');
  const [projectDescription, setProjectDescription] = useState('');

  const [ideaProjectId, setIdeaProjectId] = useState('');
  const [ideaTitle, setIdeaTitle] = useState('');
  const [ideaHypothesis, setIdeaHypothesis] = useState('');

  const [runProjectId, setRunProjectId] = useState('');
  const [runServerId, setRunServerId] = useState('local-default');
  const [runType, setRunType] = useState('AGENT');
  const [runProvider, setRunProvider] = useState('codex_cli');
  const [runPrompt, setRunPrompt] = useState('');

  const headers = useMemo(() => getAuthHeaders?.() || {}, [getAuthHeaders]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [projectsRes, ideasRes, queueRes, skillsRes] = await Promise.all([
        axios.get(`${apiUrl}/researchops/projects`, { headers }),
        axios.get(`${apiUrl}/researchops/ideas?limit=50`, { headers }),
        axios.get(`${apiUrl}/researchops/scheduler/queue?limit=50`, { headers }),
        axios.get(`${apiUrl}/researchops/skills`, { headers }),
      ]);
      const nextProjects = projectsRes.data?.items || [];
      setProjects(nextProjects);
      setIdeas(ideasRes.data?.items || []);
      setQueue(queueRes.data?.items || []);
      setSkills(skillsRes.data?.items || []);
      setIdeaProjectId((prev) => prev || nextProjects[0]?.id || '');
      setRunProjectId((prev) => prev || nextProjects[0]?.id || '');
      setLastRefreshedAt(new Date().toISOString());
    } catch (err) {
      console.error('Failed to load ResearchOps data:', err);
      setError(err?.response?.data?.error || err?.message || 'Failed to load Vibe Researcher data');
    } finally {
      setLoading(false);
    }
  }, [apiUrl, headers]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (document.hidden) return;
      loadAll();
    }, 15000);
    return () => clearInterval(interval);
  }, [loadAll]);

  const handleCreateProject = async (event) => {
    event.preventDefault();
    if (!projectName.trim()) return;
    setSubmitting(true);
    try {
      await axios.post(`${apiUrl}/researchops/projects`, {
        name: projectName.trim(),
        description: projectDescription.trim() || undefined,
      }, { headers });
      setProjectName('');
      setProjectDescription('');
      await loadAll();
    } catch (err) {
      console.error('Failed to create project:', err);
      setError(err?.response?.data?.error || 'Failed to create project');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateIdea = async (event) => {
    event.preventDefault();
    if (!ideaProjectId || !ideaTitle.trim() || !ideaHypothesis.trim()) return;
    setSubmitting(true);
    try {
      await axios.post(`${apiUrl}/researchops/ideas`, {
        projectId: ideaProjectId,
        title: ideaTitle.trim(),
        hypothesis: ideaHypothesis.trim(),
      }, { headers });
      setIdeaTitle('');
      setIdeaHypothesis('');
      await loadAll();
    } catch (err) {
      console.error('Failed to create idea:', err);
      setError(err?.response?.data?.error || 'Failed to create idea');
    } finally {
      setSubmitting(false);
    }
  };

  const handleEnqueueRun = async (event) => {
    event.preventDefault();
    if (!runProjectId || !runServerId.trim()) return;
    setSubmitting(true);
    try {
      const payload = {
        projectId: runProjectId,
        serverId: runServerId.trim(),
        runType,
        provider: runType === 'AGENT' ? runProvider.trim() || 'codex_cli' : undefined,
        metadata: runType === 'AGENT'
          ? { prompt: runPrompt.trim() || undefined }
          : {},
      };
      await axios.post(`${apiUrl}/researchops/runs/enqueue`, payload, { headers });
      setRunPrompt('');
      await loadAll();
    } catch (err) {
      console.error('Failed to enqueue run:', err);
      setError(err?.response?.data?.error || 'Failed to enqueue run');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="vibe-panel">
      <div className="vibe-toolbar">
        <h2>Vibe Researcher</h2>
        <div className="vibe-toolbar-actions">
          {lastRefreshedAt && (
            <span className="vibe-refresh-meta">
              {new Date(lastRefreshedAt).toLocaleTimeString()}
            </span>
          )}
          <button className="vibe-refresh-btn" onClick={loadAll} disabled={loading || submitting}>
            {loading ? 'Loading...' : 'Refresh'}
          </button>
        </div>
      </div>

      {error && <div className="vibe-error">{error}</div>}

      <div className="vibe-grid">
        <article className="vibe-card">
          <h3>Create Project</h3>
          <form onSubmit={handleCreateProject} className="vibe-form">
            <input
              placeholder="Project name"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              required
            />
            <textarea
              placeholder="Optional description"
              value={projectDescription}
              onChange={(e) => setProjectDescription(e.target.value)}
              rows={3}
            />
            <button type="submit" disabled={submitting}>Create Project</button>
          </form>
        </article>

        <article className="vibe-card">
          <h3>Create Idea</h3>
          <form onSubmit={handleCreateIdea} className="vibe-form">
            <select
              value={ideaProjectId}
              onChange={(e) => setIdeaProjectId(e.target.value)}
              required
            >
              <option value="">Select project</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
            <input
              placeholder="Idea title"
              value={ideaTitle}
              onChange={(e) => setIdeaTitle(e.target.value)}
              required
            />
            <textarea
              placeholder="Hypothesis"
              value={ideaHypothesis}
              onChange={(e) => setIdeaHypothesis(e.target.value)}
              rows={3}
              required
            />
            <button type="submit" disabled={submitting}>Create Idea</button>
          </form>
        </article>

        <article className="vibe-card">
          <h3>Enqueue Run</h3>
          <form onSubmit={handleEnqueueRun} className="vibe-form">
            <select
              value={runProjectId}
              onChange={(e) => setRunProjectId(e.target.value)}
              required
            >
              <option value="">Select project</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
            <input
              placeholder="Server ID"
              value={runServerId}
              onChange={(e) => setRunServerId(e.target.value)}
              required
            />
            <select value={runType} onChange={(e) => setRunType(e.target.value)}>
              <option value="AGENT">AGENT</option>
              <option value="EXPERIMENT">EXPERIMENT</option>
            </select>
            {runType === 'AGENT' && (
              <>
                <input
                  placeholder="Provider (codex_cli / claude_code / gemini_cli)"
                  value={runProvider}
                  onChange={(e) => setRunProvider(e.target.value)}
                />
                <textarea
                  placeholder="Prompt (optional)"
                  value={runPrompt}
                  onChange={(e) => setRunPrompt(e.target.value)}
                  rows={3}
                />
              </>
            )}
            <button type="submit" disabled={submitting}>Enqueue Run</button>
          </form>
        </article>
      </div>

      <div className="vibe-grid vibe-grid-bottom">
        <article className="vibe-card">
          <h3>Projects ({projects.length})</h3>
          <div className="vibe-list">
            {projects.length === 0 ? (
              <p className="vibe-empty">No projects yet.</p>
            ) : (
              projects.map((project) => (
                <div key={project.id} className="vibe-list-item">
                  <div className="vibe-list-main">
                    <strong>{project.name}</strong>
                    <span>{project.description || 'No description'}</span>
                  </div>
                  <code>{project.id}</code>
                </div>
              ))
            )}
          </div>
        </article>

        <article className="vibe-card">
          <h3>Ideas ({ideas.length})</h3>
          <div className="vibe-list">
            {ideas.length === 0 ? (
              <p className="vibe-empty">No ideas yet.</p>
            ) : (
              ideas.map((idea) => (
                <div key={idea.id} className="vibe-list-item">
                  <div className="vibe-list-main">
                    <strong>{idea.title}</strong>
                    <span>{idea.hypothesis}</span>
                  </div>
                  <code>{idea.status}</code>
                </div>
              ))
            )}
          </div>
        </article>

        <article className="vibe-card">
          <h3>Queue ({queue.length})</h3>
          <div className="vibe-list">
            {queue.length === 0 ? (
              <p className="vibe-empty">No queued runs.</p>
            ) : (
              queue.map((run) => (
                <div key={run.id} className="vibe-list-item">
                  <div className="vibe-list-main">
                    <strong>{run.runType} · {run.serverId}</strong>
                    <span>{run.projectId}</span>
                  </div>
                  <code>{run.status}</code>
                </div>
              ))
            )}
          </div>
        </article>
      </div>

      <article className="vibe-card vibe-skill-card">
        <h3>Merged Skills ({skills.length})</h3>
        <div className="vibe-skill-list">
          {skills.length === 0 ? (
            <p className="vibe-empty">No local skills found under `skills/`.</p>
          ) : (
            skills.map((skill) => (
              <span key={skill.id} className="vibe-skill-chip">{skill.name}</span>
            ))
          )}
        </div>
      </article>
    </section>
  );
}

export default VibeResearcherPanel;
