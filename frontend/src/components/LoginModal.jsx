import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';

function LoginModal({ onClose }) {
  const [token, setToken] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!token.trim()) {
      setError('Please enter a token');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const success = await login(token.trim());
      if (success) {
        onClose();
      } else {
        setError('Invalid token');
      }
    } catch (err) {
      setError('Failed to verify token');
    } finally {
      setLoading(false);
    }
  };

  const handleBackdropClick = (e) => {
    if (e.target.classList.contains('modal-backdrop')) {
      onClose();
    }
  };

  return (
    <div className="modal-backdrop" onClick={handleBackdropClick}>
      <div className="login-modal">
        <div className="login-modal-header">
          <h2>Admin Login</h2>
          <button className="close-btn" onClick={onClose}>
            &times;
          </button>
        </div>

        <form onSubmit={handleSubmit} className="login-form">
          <div className="form-group">
            <label htmlFor="token">Admin Token</label>
            <input
              type="password"
              id="token"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Enter your admin token"
              autoFocus
              disabled={loading}
            />
          </div>

          {error && <div className="login-error">{error}</div>}

          <div className="login-actions">
            <button type="button" className="cancel-btn" onClick={onClose} disabled={loading}>
              Cancel
            </button>
            <button type="submit" className="login-btn" disabled={loading}>
              {loading ? 'Verifying...' : 'Login'}
            </button>
          </div>

          <p className="login-hint">
            Enter the ADMIN_TOKEN from your server&apos;s .env file.
            <br />
            Without logging in, the library is read-only.
          </p>
        </form>
      </div>
    </div>
  );
}

export default LoginModal;
