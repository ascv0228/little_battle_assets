# little_battle_assets

Independent game-content repository and **Node.js** API server. Git history stays separate from little_battle_pygame.

## Layout

- `temp_assets/`: temporary original downloads; ignored, never required by the published game.
- `lpc_entry/`, `other_assets/`: authored source artwork copied from staging, used by offline builds only.
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

Default endpoint: `http://127.0.0.1:8787`.

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
The Pages workflow builds and publishes only static game resources. Host the Node server separately, with HTTPS and private environment settings.
Set the client's `LITTLE_BATTLE_ASSET_MANIFEST_URL` to the Pages manifest URL and `LITTLE_BATTLE_API_URL` to that separate Node service.
Both services must use the same published content/version. The client rejects mismatched asset/catalog versions.

The publisher hashes content into immutable release directories, activates the manifest after all files are copied, and preserves old releases.
An app checks the manifest every startup and downloads only files whose cached SHA-256 does not match.

## MongoDB data

`catalogs` stores versioned character/stat/stage/summon documents; `players` stores hashed installation identities and team slots.
Generated catalog data is inserted once per version, so server-side balance edits to that document are not overwritten at every request.
Publishing modified content creates a new version/document.

## Version control

Commit authored source art, frame-map recipes, gameplay JSON, code and lockfiles. Do not commit generated atlases, `public/`, `.env`, credentials, node_modules or discovery download caches.
Local Git commits never imply pushing or deploying. Existing `temp_assets/` remains a private staging area.
