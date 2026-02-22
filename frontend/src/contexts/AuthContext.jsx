import { createContext, useContext, useState, useEffect, useCallback } from 'react';

const AuthContext = createContext(null);

const AUTH_TOKEN_KEY = 'auto_reader_auth_token';

export function AuthProvider({ children, apiUrl }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [username, setUsername] = useState(null);

  const getToken = useCallback(() => {
    return localStorage.getItem(AUTH_TOKEN_KEY);
  }, []);

  // Verify a JWT with the backend
  const verifyToken = useCallback(async (token) => {
    if (!token) {
      setIsAuthenticated(false);
      setIsLoading(false);
      return false;
    }

    try {
      const response = await fetch(`${apiUrl}/auth/verify`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      const data = await response.json();

      if (data.valid || data.authEnabled === false) {
        setIsAuthenticated(true);
        setIsLoading(false);
        // Fetch username
        const meRes = await fetch(`${apiUrl}/auth/me`, {
          headers: { 'Authorization': `Bearer ${token}` },
        });
        if (meRes.ok) {
          const me = await meRes.json();
          setUsername(me.username);
        }
        return true;
      } else {
        localStorage.removeItem(AUTH_TOKEN_KEY);
        setIsAuthenticated(false);
        setIsLoading(false);
        return false;
      }
    } catch {
      setIsLoading(false);
      return false;
    }
  }, [apiUrl]);

  // Check stored token on mount
  useEffect(() => {
    verifyToken(getToken());
  }, [getToken, verifyToken]);

  // Login with username + password
  const login = useCallback(async (usernameInput, password) => {
    try {
      const response = await fetch(`${apiUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: usernameInput, password }),
      });
      const data = await response.json();

      if (!response.ok || !data.token) {
        return { success: false, error: data.error || 'Login failed' };
      }

      localStorage.setItem(AUTH_TOKEN_KEY, data.token);
      setIsAuthenticated(true);
      setUsername(data.username);
      return { success: true };
    } catch {
      return { success: false, error: 'Network error' };
    }
  }, [apiUrl]);

  const logout = useCallback(async () => {
    try {
      await fetch(`${apiUrl}/auth/logout`, { method: 'POST', credentials: 'include' });
    } catch { /* ignore network errors on logout */ }
    localStorage.removeItem(AUTH_TOKEN_KEY);
    setIsAuthenticated(false);
    setUsername(null);
  }, [apiUrl]);

  const getAuthHeaders = useCallback(() => {
    const token = getToken();
    return token ? { 'Authorization': `Bearer ${token}` } : {};
  }, [getToken]);

  return (
    <AuthContext.Provider value={{
      isAuthenticated,
      isLoading,
      username,
      login,
      logout,
      getToken,
      getAuthHeaders,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
}

export default AuthContext;
