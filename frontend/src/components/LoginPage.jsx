import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';

function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!username.trim() || !password) {
      setError('Please enter username and password');
      return;
    }
    setLoading(true);
    setError(null);
    const result = await login(username.trim(), password);
    if (!result.success) {
      setError(result.error || 'Invalid username or password');
      setLoading(false);
    }
    // On success, AuthContext sets isAuthenticated → App renders normally
  };

  return (
    <div className="login-page">
      <div className="login-page-card">
        <div className="login-page-logo">Auto Reader</div>
        <h2 className="login-page-title">Sign in</h2>
        <form onSubmit={handleSubmit} className="login-page-form">
          <div className="login-page-field">
            <label htmlFor="lp-username">Username</label>
            <input
              id="lp-username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Username"
              autoFocus
              autoComplete="username"
              disabled={loading}
            />
          </div>
          <div className="login-page-field">
            <label htmlFor="lp-password">Password</label>
            <input
              id="lp-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              autoComplete="current-password"
              disabled={loading}
            />
          </div>
          {error && <p className="login-page-error">{error}</p>}
          <button type="submit" className="login-page-btn" disabled={loading}>
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}

export default LoginPage;
