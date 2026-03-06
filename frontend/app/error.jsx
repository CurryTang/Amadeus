'use client';

export default function Error({ error, reset }) {
  return (
    <div style={{ fontFamily: 'system-ui,sans-serif', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: '#f8fafc' }}>
      <div style={{ textAlign: 'center', maxWidth: 400, padding: 32 }}>
        <h2 style={{ fontSize: '1.1rem', color: '#1e293b', marginBottom: 10 }}>Something went wrong</h2>
        {error?.message && (
          <p style={{ fontSize: '0.82rem', color: '#94a3b8', marginBottom: 18, wordBreak: 'break-word' }}>{error.message}</p>
        )}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
          <button
            onClick={() => window.location.reload()}
            style={{ padding: '7px 16px', background: '#6366f1', color: '#fff', border: 'none', borderRadius: 7, cursor: 'pointer', fontSize: '0.875rem' }}
          >
            Reload
          </button>
          <button
            onClick={() => reset()}
            style={{ padding: '7px 16px', background: '#fff', color: '#334155', border: '1px solid #e2e8f0', borderRadius: 7, cursor: 'pointer', fontSize: '0.875rem' }}
          >
            Try Again
          </button>
        </div>
      </div>
    </div>
  );
}
