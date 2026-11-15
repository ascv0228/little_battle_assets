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

The client now targets the local Nginx proxy at `http://127.0.0.1:8080` by default. Run `deploy/start-local.bat` to start the Node API on loopback port 8787 and Nginx on port 8080. `npm start` starts only the API; it does not start Nginx.

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
Accounts are currently installation identities, not username/password login or cross-device account recovery.

## GitHub Pages versus API hosting

Pages can serve `public/manifest.json` and `public/releases/...`. It cannot run Node.js or connect to MongoDB.
The Pages workflow publishes a prepared ZIP of game-ready `assets/` contents. Build locally with `temp_assets/` present, run `python tools/prepared_bundle.py pack data/game-assets.zip`, upload that ZIP to a release or HTTPS storage, then supply its URL when manually running the Pages workflow. A clean checkout cannot rebuild ignored original downloads; CI does not require them. Host the Node server separately, with HTTPS and private environment settings.
Set the client's `LITTLE_BATTLE_ASSET_MANIFEST_URL` to the Pages manifest URL and `LITTLE_BATTLE_API_URL` to that separate Node service.
Both services must use the same published content/version. The client rejects mismatched asset/catalog versions.

The publisher hashes content into immutable release directories, activates the manifest after all files are copied, and preserves old releases.
An app checks the manifest every startup and downloads only files whose cached SHA-256 does not match.

## Nginx deployment (Windows)

`deploy/start-local.bat` starts the Node API on `127.0.0.1:8787` and the local Nginx proxy on `127.0.0.1:8080`. It is only for local development and does not expose the service to the Internet. Use `deploy/stop-local.bat` to stop it.

For public access, first point your domain's DNS A/AAAA record at this machine's public IP, forward TCP ports 80 and 443 through the router/firewall, and obtain a TLS certificate with a PEM certificate chain and private key. Copy `deploy/nginx.public.conf.example` to the ignored `deploy/nginx.public.conf`, then replace `game.example.com` and the certificate/key paths. The template serves immutable assets directly from `public/` and reverse-proxies `/api/` and `/health` to Node on loopback. Start and stop with `deploy/start-public.bat` and `deploy/stop-public.bat` only after the public config and certificate are ready.

Configure remote clients with both URLs on the same HTTPS domain:

```powershell
$env:LITTLE_BATTLE_ASSET_MANIFEST_URL = 'https://YOUR-DOMAIN/assets/manifest.json'
$env:LITTLE_BATTLE_API_URL = 'https://YOUR-DOMAIN'
```

The client intentionally rejects remote HTTP because bearer tokens would otherwise travel unencrypted. Keep MongoDB credentials private in `.env` or `atlas-credentials.env`; do not expose port 8787 publicly. Both the public manifest and Node catalog must refer to the same published content version.

## MongoDB data

`catalogs` stores versioned character/stat/stage/summon documents; `players` stores hashed installation identities and team slots.
Generated catalog data is inserted once per version, so server-side balance edits to that document are not overwritten at every request.
Publishing modified content creates a new version/document.

## Version control

Commit frame-map recipes, gameplay JSON, code and lockfiles. Keep all original artwork, downloads and extracted sources only in ignored `temp_assets/`; do not commit them. Do not commit generated atlases, `public/`, `.env`, credentials, node_modules or discovery download caches.
Local Git commits never imply pushing or deploying. Existing `temp_assets/` remains a private staging area.

## Reviewed downloaded packs

Run python tools/register_luizmelo.py to register the reviewed CC0 packs from temp_assets/itch_io, compile their animation packages and publish a new version in one command. Use --register-only only when preparing recipes without publication. Registered entries: human_martial_hero plus monster_lm_skeleton, monster_lm_mushroom, monster_lm_goblin and monster_lm_flying_eye. Martial Hero is also a team/summon option. The client discovers these prepared packages automatically in the character/monster codex after its next startup update.

Red Panda remains private in temp_assets: its source license prohibits asset redistribution, so it is excluded from public game packages.
