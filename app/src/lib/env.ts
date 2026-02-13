// Type-safe environment variable access for server-side code.
// All variables are validated at first access — missing values throw immediately.

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. ` +
        `See .env.local.example for setup instructions.`
    );
  }
  return value;
}

export const env = {
  get GITHUB_CLIENT_ID() {
    return required("GITHUB_CLIENT_ID");
  },
  get GITHUB_CLIENT_SECRET() {
    return required("GITHUB_CLIENT_SECRET");
  },
  get SESSION_SECRET() {
    return required("SESSION_SECRET");
  },
  get NEXT_PUBLIC_APP_URL() {
    return required("NEXT_PUBLIC_APP_URL");
  },
} as const;
