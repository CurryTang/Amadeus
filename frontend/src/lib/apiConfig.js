export function resolveApiConfig({ processEnv = {}, viteEnv = {} } = {}) {
  const nodeEnv = String(processEnv?.NODE_ENV || '').trim();
  const viteMode = String(viteEnv?.MODE || '').trim();
  const mode = viteMode || nodeEnv;
  const isDev = mode ? mode.toLowerCase() !== 'production' : true;
  const devApiUrl = processEnv?.NEXT_PUBLIC_DEV_API_URL || viteEnv?.VITE_DEV_API_URL || '/api';
  const prodApiUrl = processEnv?.NEXT_PUBLIC_API_URL || viteEnv?.VITE_API_URL || '/api';
  const timeoutMs = Number(processEnv?.NEXT_PUBLIC_API_TIMEOUT_MS || viteEnv?.VITE_API_TIMEOUT_MS || 15000);

  return {
    isDev,
    apiUrl: isDev ? devApiUrl : prodApiUrl,
    timeoutMs,
  };
}
