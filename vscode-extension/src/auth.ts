type SecretContext = {
  secrets: {
    get(key: string): Thenable<string | undefined> | Promise<string | undefined>;
    store(key: string, value: string): Thenable<void> | Promise<void>;
    delete(key: string): Thenable<void> | Promise<void>;
  };
};

const AUTH_TOKEN_KEY = 'aris.authToken';

export async function getAuthToken(context: SecretContext): Promise<string | undefined> {
  return context.secrets.get(AUTH_TOKEN_KEY);
}

export async function storeAuthToken(context: SecretContext, token: string): Promise<void> {
  await context.secrets.store(AUTH_TOKEN_KEY, token);
}

export async function deleteAuthToken(context: SecretContext): Promise<void> {
  await context.secrets.delete(AUTH_TOKEN_KEY);
}
