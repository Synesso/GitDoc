# GitDoc

A web application for reviewing markdown files in GitHub Pull Requests. GitDoc renders changed `.md` files as they will appear to readers and lets reviewers leave comments that are persisted as native GitHub PR line comments.

## Local Development

### Prerequisites

- [Node.js](https://nodejs.org/) (v20+)
- npm

### 1. Set Up a GitHub OAuth App

1. Go to [GitHub Developer Settings → OAuth Apps → New OAuth App](https://github.com/settings/developers).
2. Fill in the form:
   - **Application name**: `GitDoc (dev)` (or anything you like)
   - **Homepage URL**: `http://localhost:3000`
   - **Authorization callback URL**: `http://localhost:3000/api/auth/callback`
3. Click **Register application**.
4. On the next page, copy the **Client ID**.
5. Click **Generate a new client secret** and copy the secret immediately (it is only shown once).

### 2. Configure Environment Variables

```bash
cp .env.local.example .env.local
```

Edit `.env.local` and fill in the values:

```env
GITHUB_CLIENT_ID=<your OAuth App client ID>
GITHUB_CLIENT_SECRET=<your OAuth App client secret>
SESSION_SECRET=<random 32+ character hex string>
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

Generate a session secret with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 3. Install Dependencies and Run

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Available Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start the development server with hot reload |
| `npm run build` | Create a production build |
| `npm run start` | Serve the production build |
| `npm run lint` | Run ESLint |

## Deployment

See the [Vercel deployment instructions](#deploy-on-vercel) below.

### Deploy on Vercel

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
