export type ArisExtensionConfig = {
  apiBaseUrl: string;
  refreshIntervalSeconds: number;
  defaultProjectId: string;
  defaultWorkflowType: string;
};

type ConfigurationApi = {
  workspace: {
    getConfiguration(section: string): {
      get<T>(key: string, fallback: T): T;
    };
  };
};

export function getArisConfig(vscodeApi: ConfigurationApi): ArisExtensionConfig {
  const config = vscodeApi.workspace.getConfiguration('aris');
  return {
    apiBaseUrl: config.get('apiBaseUrl', 'http://127.0.0.1:3000/api'),
    refreshIntervalSeconds: config.get('refreshIntervalSeconds', 20),
    defaultProjectId: config.get('defaultProjectId', 'default-project'),
    defaultWorkflowType: config.get('defaultWorkflowType', 'literature_review'),
  };
}
