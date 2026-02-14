This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

1. **Create a GitHub OAuth App** at <https://github.com/settings/developers>:
   - Set **Authorization callback URL** to `https://<your-domain>/api/auth/callback`

2. **Import the project** on [Vercel](https://vercel.com/new) and set the **Root Directory** to `app/`.

3. **Add the following environment variables** in the Vercel project settings (Settings → Environment Variables):

   | Variable | Type | Description |
   |----------|------|-------------|
   | `GITHUB_CLIENT_ID` | Plain text | OAuth App client ID |
   | `GITHUB_CLIENT_SECRET` | Sensitive | OAuth App client secret |
   | `SESSION_SECRET` | Sensitive | 32+ character random string for `iron-session` cookie encryption (generate with `openssl rand -hex 32`) |
   | `NEXT_PUBLIC_APP_URL` | Plain text | Canonical app URL, e.g. `https://gitdoc.example.com` (no trailing slash) |

   Mark `GITHUB_CLIENT_SECRET` and `SESSION_SECRET` as **Sensitive** so they are encrypted at rest and hidden in logs.

4. **Deploy** — Vercel auto-detects the Next.js framework and applies the configuration from `vercel.json`.
