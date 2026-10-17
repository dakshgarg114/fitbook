# Fitbook

A mobile-first food diary that feels like a notebook. Tell it what you ate, in words or with a photo, and it logs the meal, looks up the nutrition, scores your day and sketches the food on a hand-drawn daily canvas. A light coach in the same chat answers questions about your day and nudges you when something is clearly off.

- **Chat to log:** "had 2 rotis and dal for lunch", a meal photo, or voice. You change the canvas only through chat ("it was 2 rotis, not 3", "remove the coffee").
- **Daily canvas:** each meal gets a doodle on a ruled notebook page. Pull to move between days, or pick one from the calendar.
- **Scores out of 10:** carbs, fiber, protein, antioxidants and an overall score, based on your own targets.
- **Targets:** worked out from your profile (Mifflin-St Jeor), or set your own by chat ("120 g protein a day").
- **Themes:** Paper, Midnight, Sage and Dusk. Installable as a home-screen app on iPhone.

## How it works

```
web/      Preact + Vite single-page app (the notebook UI)
server/   Node + Hono API, SQLite storage (node:sqlite), Firebase ID-token auth
shared/   Types shared by both
```

When you send a message, the server runs a DeepSeek model in a tool loop (`server/src/agent.ts`, `server/src/tools.ts`) in the background, so closing the app doesn't stop it. The agent can read any day, look up nutrition, add, change or remove meals on the page you're viewing or another day, update your profile and goals, and remember lasting facts like "vegetarian". Changes are staged and saved together at the end.

Nutrition comes from tables, not from the model: [USDA FoodData Central](https://fdc.nal.usda.gov/) for cooked dishes, and the Indian Food Composition Tables 2017 (National Institute of Nutrition, ICMR; via the MIT-licensed [`@ifct2017/compositions`](https://www.npmjs.com/package/@ifct2017/compositions) package, pinned because later releases moved to AGPL) for raw ingredients and home recipes. The model's estimate is the fallback, and optional web search covers branded foods. Doodles are composed from a small library of hand-drawn SVG parts (`server/src/doodle`); the model only picks the parts. Every change to a day's canvas is saved as a new version.

## Setup

You need **Node 22.18 or newer** (the server runs TypeScript directly) and **[pnpm](https://pnpm.io/installation)**.

```sh
git clone https://github.com/dakshgarg114/fitbook.git
cd fitbook
pnpm install
cp .env.example .env
```

Then fill in `.env` with the keys below.

### 1. DeepSeek API key (required)

1. Create an account at [platform.deepseek.com](https://platform.deepseek.com) and add credit.
2. Create a key under **API keys** and set it as `DEEPSEEK_API_KEY`.

### 2. USDA FoodData Central key (optional)

`DEMO_KEY` works for light use. For your own limits, sign up at [fdc.nal.usda.gov/api-key-signup](https://fdc.nal.usda.gov/api-key-signup) and set `USDA_API_KEY`.

### 3. Firebase project for Google sign-in

Fitbook uses Firebase Authentication only to sign people in with Google. The server checks each request's ID token against your project; no service account is needed.

1. Go to the [Firebase console](https://console.firebase.google.com/) and **Add project** (Google Analytics is not needed).
2. **Build > Authentication > Get started**, then under **Sign-in method** enable **Google**.
3. **Authentication > Settings > Authorized domains:** add the domain you will serve Fitbook from (for example `fitbook.example.com`). `localhost` is there by default.
4. **Project settings > General > Your apps:** add a **Web app** (no hosting needed) and copy its config into `.env`:

   | Firebase config | `.env`                                               |
   | --------------- | ---------------------------------------------------- |
   | `apiKey`        | `VITE_FIREBASE_API_KEY`                              |
   | `authDomain`    | `VITE_FIREBASE_AUTH_DOMAIN`                          |
   | `projectId`     | `VITE_FIREBASE_PROJECT_ID` and `FIREBASE_PROJECT_ID` |
   | `appId`         | `VITE_FIREBASE_APP_ID`                               |

5. Recommended: in [Google Cloud console > APIs & Services > Credentials](https://console.cloud.google.com/apis/credentials), open the **Browser key** Firebase created and restrict it to your domains (HTTP referrers). The web config is public by design, since it ships in the page, so this restriction is what protects it.

### 4. Everything else

| Variable                                    | Purpose                                                                                                  |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `DEV_USER_EMAIL`                            | Local development only: skip sign-in and treat every request as this email. Never set it in production.  |
| `CHAT_LIMIT_PER_HOUR`, `CHAT_LIMIT_PER_DAY` | Per-user message limits (defaults 60 and 100).                                                           |
| `PORT`                                      | Server port (default `4310`).                                                                            |
| `FITBOOK_DB`                                | SQLite file (default `data/fitbook.db`).                                                                 |
| `TAVILY_API_KEY`                            | Optional: lets the agent search the web for branded foods ([tavily.com](https://tavily.com), free tier). |

## Local development

Run the API and the web app in two terminals:

```sh
pnpm dev:server   # API on http://127.0.0.1:4310, restarts on changes
pnpm dev:web      # app on http://localhost:5173, proxies /api to the server
```

To try it without setting up Firebase, set `DEV_USER_EMAIL=you@example.com` and leave the `VITE_FIREBASE_*` values empty: sign-in is skipped and everything runs as that user.

Before opening a pull request, run the checks:

```sh
pnpm check    # typecheck, lint and format check
pnpm format   # fix formatting
```

## Deploying

In production one Node process serves both the API and the built web app.

```sh
pnpm build    # builds web/dist (reads the VITE_* values from .env)
pnpm start    # serves everything on PORT (default 4310)
```

The `VITE_FIREBASE_*` values are baked in at build time, so rebuild after changing them. Database migrations run automatically when the server starts. All your data (the SQLite database and meal photos) lives in `data/`, which is git-ignored; back it up.

### Keep it running with pm2

[`ecosystem.config.cjs`](ecosystem.config.cjs) runs the server with [pm2](https://pm2.keymetrics.io/), and [`scripts/deploy.sh`](scripts/deploy.sh) installs, builds and (re)starts it:

```sh
npm install -g pm2
./scripts/deploy.sh
pm2 startup && pm2 save   # start again after a reboot
```

If you don't use the Cloudflare Tunnel below, remove the `fitbook-tunnel` entry from `ecosystem.config.cjs`.

### Put it on the internet

The server listens on `127.0.0.1`, so put HTTPS in front of it. Google sign-in needs HTTPS and a domain listed in Firebase's authorized domains.

**Option A: Cloudflare Tunnel** (no open ports, works from a home machine):

```sh
cloudflared tunnel login
cloudflared tunnel create fitbook
cloudflared tunnel route dns fitbook fitbook.example.com
cp scripts/cloudflared.example.yml scripts/cloudflared.yml   # fill in the tunnel ID, credentials path and hostname
```

`scripts/deploy.sh` then starts the tunnel with pm2 alongside the app.

**Option B: any reverse proxy**, for example [Caddy](https://caddyserver.com/) on a server with a public IP:

```
fitbook.example.com {
  reverse_proxy 127.0.0.1:4310
}
```

## Contributing

Issues and pull requests are welcome. Keep changes focused, match the style of the surrounding code, and make sure `pnpm check` passes.

## Disclaimer

Fitbook gives rough, automated estimates. It is not medical or dietary advice.

## License

[MIT](LICENSE)
