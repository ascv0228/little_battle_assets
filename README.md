# little_battle_assets

Independent game-content repository and **Node.js** API server. Git history stays separate from little_battle_pygame.

## Layout

- `temp_assets/`: all original downloads, archives and extracted source artwork; ignored by Git. Offline builders read this directory; the running game never does. Existing LPC sources are at `temp_assets/lpc_entry/`; other packs are directly under `temp_assets/<pack>/`. Approved itch.io imports use `temp_assets/imported/<id>/`, including original downloads and provenance.
- No top-level `lpc_entry/` or `other_assets/` directories are used or created.
- `asset_sources/characters/`: per-character frame maps, stats, gear defense and animation labels.
- `tools/`: offline image processing; pygame is a build dependency, **not a server**.
- `assets/`: generated game-ready atlas packages, gameplay JSON and props; not committed.
- `public/`: generated immutable releases and `manifest.json`; the only Pages upload directory.
- `server/`: Node HTTP API with MongoDB catalog and player-team persistence.
- `worker/`: itch.io discovery and qualified-source import workflow.

No `.env`, Mongo credentials, raw source folder or temporary downloads enter the public manifest.

## Build and run locally

Requires Node.js 22+ and Python 3.12/pygame for **offline asset building**. The running API server uses Node.js only.

```powershell
npm install
python -m pip install pygame==2.6.1
python tools/build_character_assets.py
python tools/build_training_dummy.py
npm run publish:assets
npm test
npm start
```

The server loads `.env`, or the existing ignored `atlas-credentials.env` when `.env` is absent.
Required `MONGODB_URI`; optional `MONGODB_USERNAME`, `MONGODB_PASSWORD` fill `<db_username>` / `<db_password>` URI placeholders.
The Mongo database defaults to `little_battle`, overridable with `MONGODB_DATABASE`.
Database connection errors are reported without printing the URI or password.

The native pygame client defaults to the public ngrok HTTPS address `https://bee-content-finch.ngrok-free.app`. Node listens only on `127.0.0.1:5000` and serves both immutable assets and the JSON API directly. No Nginx service or configuration is required. Existing API payloads and asset URLs are unchanged.

| Endpoint | Purpose |
| --- | --- |
| `GET /health` | Reports asset publication and actual database availability |
| `GET /assets/manifest.json` | Latest asset version, file sizes and SHA-256 |
| `GET /assets/releases/<version>/<path>` | Immutable game-ready resource |
| `POST /api/session` | Create anonymous persistent installation identity; `{token}` resumes an existing identity |
| `GET /api/catalog` | MongoDB-backed character definitions, stages and summon offers for the current asset version |
| `GET /api/player/team` | Read the bearer-token owner's team |
| `PUT /api/player/team` | Save exactly 16 unique known ally IDs/nulls, with at least one member |

Bearer tokens are stored hashed in MongoDB. Clients never connect directly to MongoDB.
Named accounts now use username/password login. Legacy installation identities remain separate for compatibility; they are not automatically converted, imported or overwritten. Named-account teams belong to a stable user ID, not a session token.

### Account API

| Endpoint | Request / response |
| --- | --- |
| `POST /api/auth/register` | `{username,password}` -> HTTP 201 `{user:{id,username},token,expiresAt}` |
| `POST /api/auth/login` | `{username,password}` -> HTTP 200 with the same session shape |
| `GET /api/auth/me` | Bearer token -> `{user:{id,username},expiresAt}` |
| `POST /api/auth/logout` | Bearer token -> `{ok:true}`; revokes that server session |

Usernames are case-insensitive, canonicalized to lowercase, and contain 3–32 ASCII letters, digits, underscores or hyphens. Passwords contain 12–128 Unicode code points, are not trimmed, and are limited to 512 UTF-8 bytes. Passwords use a per-user random salt and asynchronous scrypt (`N=32768,r=8,p=3`); password plaintext is never stored. At most two expensive hashes run concurrently. Login attempts are throttled by normalized username and direct socket IP (the process-local limiter resets on server restart; the shared ngrok loopback IP can rate-limit multiple users).

MongoDB `users` has a unique username index; `sessions` stores only the token digest, stable `userId` and seven-day expiry with a TTL index. Expiry is checked during authentication rather than relying on delayed TTL cleanup. Logout invalidates only the submitted session. Invalid login credentials use one error; duplicate registration explicitly returns HTTP 409 `ACCOUNT_EXISTS`. Password reset, email verification, MFA and anonymous-team import are not implemented in this first version.

### Shared HTTP JSON contract

- Requests with bodies use `Content-Type: application/json`; authenticated team requests use `Authorization: Bearer <installation-token>`.
- `POST /api/session` accepts `{}` for a new identity or `{"token":"..."}` to resume it; success returns `{"token":"..."}`. Resuming never silently creates a different identity.
- `GET /api/player/team` returns `{"slots":null}` for an identity without a saved team, otherwise `{"slots":[...]}` with exactly 16 entries.
- `PUT /api/player/team` accepts `{"slots":[...]}` and acknowledges the saved 16 entries in the same shape. Entries are distinct known character IDs or `null`, with at least one character. The backend remains responsible for validation and persistence; the APP must wait for a valid acknowledgment before reporting success or starting a sortie.
- Database outages return HTTP 503 with an error object, not a synthetic success or volatile player data. `/assets/` remains independent of MongoDB; `/health` returns HTTP 503 while the database or published manifest is unavailable.
- This is an HTTP request/response protocol, not a WebSocket or multiplayer battle protocol.

## GitHub Pages versus API hosting

Pages can serve `public/manifest.json` and `public/releases/...`. It cannot run Node.js or connect to MongoDB.
The Pages workflow publishes a prepared ZIP of game-ready `assets/` contents. Build locally with `temp_assets/` present, run `python tools/prepared_bundle.py pack data/game-assets.zip`, upload that ZIP to a release or HTTPS storage, then supply its URL when manually running the Pages workflow. A clean checkout cannot rebuild ignored original downloads; CI does not require them. Host the Node server separately, with HTTPS and private environment settings.
Set the client's `LITTLE_BATTLE_ASSET_MANIFEST_URL` to the Pages manifest URL and `LITTLE_BATTLE_API_URL` to that separate Node service.
Both services must use the same published content/version. The client rejects mismatched asset/catalog versions.

The publisher hashes content into immutable release directories, activates the manifest after all files are copied, and preserves old releases.
An app checks the manifest every startup and downloads only files whose cached SHA-256 does not match.

## Direct Node + ngrok deployment (Windows)

`deploy/start-local.bat` starts Node directly on `127.0.0.1:5000`, explicitly setting `HOST` and `PORT` for that process; it is local-only. `deploy/start-tunnel.bat` checks the ngrok config, launches the local application, waits for the local `/health` endpoint, then opens the reserved public tunnel:

```powershell
ngrok http --domain=bee-content-finch.ngrok-free.app --inspect=false 5000
```

The script uses `D:\Tool\ngrok\ngrok.exe` and only starts the tunnel after health reports success, so MongoDB must be reachable and assets published first. Node handles `/assets/`, `/api/` and `/health` on the same loopback port. `deploy/stop-tunnel.bat` closes the project's ngrok and API windows; `deploy/stop-local.bat` closes only the project's API window. Neither script manages system-wide proxy services.

The application retains bearer-token validation, per-player team authorization, a 64 KiB JSON body limit, browser-origin checks, restricted public asset paths, immutable release caching and no-store manifest/API responses. Credentials and raw assets are not served. The current protocol is HTTP JSON plus resource downloads: there are no multiplayer room, WebSocket or authoritative battle-state recovery endpoints. Session resumption restores installation identity and saved teams, not a multiplayer battle.

New tunnel launches disable HTTP inspection to avoid collecting login request bodies. This does not reconfigure an already-running ngrok tunnel: restart it with `--inspect=false` before using real account passwords. Do not enable request-body logging in ngrok policies, the application or any future gateway.

If a previous deployment is still running, stop that project's old processes before starting this version so port 5000 is free. When running `npm start` directly with an existing private environment file, remove an old `PORT=8787` override or change it to `PORT=5000`; the deployment batch script already overrides it without editing credentials.

ngrok provides the public HTTPS endpoint, so this setup does not require a TLS certificate, router port forwarding, or inbound firewall rules. The ngrok CLI must be installed, authenticated, and able to connect outbound. When the tunnel is stopped, the public domain returns ngrok's offline page.

Remote clients use:

```text
Assets: https://bee-content-finch.ngrok-free.app/assets/manifest.json
API:    https://bee-content-finch.ngrok-free.app
```

For local testing, set the client config to `config/client.local.example.json`. Keep MongoDB credentials private and port 5000 bound to loopback; ngrok is the public entry point. The public manifest and Node catalog must refer to the same published content version.

## MongoDB data

`catalogs` stores versioned character/stat/stage/summon documents; `players` stores hashed installation identities and team slots.
Generated catalog data is inserted once per version, so server-side balance edits to that document are not overwritten at every request.
Publishing modified content creates a new version/document.

The application opens its HTTP listener independently of the initial database connection. A single controlled connection loop retries initial failures with capped exponential backoff, closes failed clients and stops retrying on shutdown. Credentials are never logged. Once MongoDB connects successfully, data APIs recover without an application restart. Existing connected-client topology recovery remains the MongoDB driver's responsibility; there is no in-memory fallback.

## Version control

Commit frame-map recipes, gameplay JSON, code and lockfiles. Keep all original artwork, downloads and extracted sources only in ignored `temp_assets/`; do not commit them. Do not commit generated atlases, `public/`, `.env`, credentials, node_modules or discovery download caches.
Local Git commits never imply pushing or deploying. Existing `temp_assets/` remains a private staging area.

## Reviewed downloaded packs

Run python tools/register_luizmelo.py to register the reviewed CC0 packs from temp_assets/itch_io, compile their animation packages and publish a new version in one command. Use --register-only only when preparing recipes without publication. Registered entries: human_martial_hero plus monster_lm_skeleton, monster_lm_mushroom, monster_lm_goblin and monster_lm_flying_eye. Martial Hero is also a team/summon option. The client discovers these prepared packages automatically in the character/monster codex after its next startup update.

Red Panda remains private in temp_assets: its source license prohibits asset redistribution, so it is excluded from public game packages.
