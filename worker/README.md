# Asset discovery and reviewed imports

`node worker/discover.mjs` reads the official public RSS browse feeds in `config/discovery.json`. It merges a provenance queue into ignored `data/discovery/candidates.json`. It does not authenticate, purchase, bypass a download page, infer license permission from a free price, or publish unreviewed art.

The daily GitHub Actions workflow retains that queue as an artifact. Local recurring agents can run the same command. A failed feed is recorded separately; if every feed fails the command exits nonzero. No token is required for public feeds.

To import a known asset, create a descriptor with:

- `schema_version: 1`, a complete game `character` definition and `animations` frame maps matching the offline builder format.
- `source.page_url`, `source.author`, and `source.license` containing `id`, `evidence_url`, `reviewed_by`, `reviewed_at`, `game_use: true`, and `asset_redistribution: true`.
- `source.downloads`: HTTPS URL, exact SHA256, and either `format: "png"` plus a relative PNG `destination`, or `format: "zip"` plus explicit `extract: [{entry, destination}]` PNG mappings.

Run `node worker/import-approved.mjs descriptor.json --dry-run` first. Remove `--dry-run` to install the verified source into `temp_assets/imported/<character-id>/`, preserve provenance, and create `asset_sources/characters/<character-id>.json`. Existing characters are never overwritten. Required move/attack/death frame maps, dimensions, damage stats and hit timing are checked before installation. Other art remains quarantined until its license and frames can be verified. Optional animations must map real source frames, not guessed rows.

After import, run the offline image builder and publisher documented in the repository root. Importing does not publish automatically or execute scripts from an asset archive. The archive reader rejects traversal, symlinks, duplicate paths, encryption and excessive expansion. Downloads are size-limited and SHA256-pinned. Original PNG/ZIP downloads are retained under temp_assets/imported/<id>/downloads/ and extracted images alongside provenance stay under that same ignored source directory. Commit only curated recipes and source/license metadata in asset_sources, configuration and code; never commit raw artwork, temporary downloads or compiled output.

Public downloadable PNG atlases can constitute asset redistribution. A game-use-only license is therefore insufficient for automatic public-resource publication; preserve its restriction and do not set the redistribution flag without evidence.
