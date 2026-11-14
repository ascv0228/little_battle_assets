"""Register reviewed CC0 LuizMelo packs from temp_assets, then build/publish them."""
import argparse
import hashlib
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
IDS = ('human_martial_hero', 'monster_lm_skeleton', 'monster_lm_mushroom',
       'monster_lm_goblin', 'monster_lm_flying_eye')


def register(root=ROOT):
    recipes = root / 'asset_sources' / 'characters'
    recipes.mkdir(parents=True, exist_ok=True)
    packs = {}
    for pack in ('luizmelo_martial_hero', 'luizmelo_monsters_creatures_fantasy'):
        folder = root / 'temp_assets' / 'itch_io' / pack
        metadata = json.loads((folder / 'source.json').read_text())
        if metadata['license'] != 'CC0' or not metadata['public_release_allowed']:
            raise ValueError('Only reviewed CC0 sources can be registered')
        for download in metadata['downloads']:
            if hashlib.sha256((folder / download['file']).read_bytes()).hexdigest() != download['sha256']:
                raise ValueError('Original download changed')
        packs[pack] = (folder, metadata)

    units = [
        (IDS[0], 'Martial Hero', 'luizmelo_martial_hero', 'Martial Hero/Sprites', 200, 2, 122, True,
         {'idle': ('Idle', 8), 'walk': ('Run', 8), 'attack': ('Attack1', 6), 'attack2': ('Attack2', 6),
          'jump': ('Jump', 2), 'fall': ('Fall', 2), 'hurt': ('Take Hit', 4), 'death': ('Death', 6)}),
    ]
    for ident, folder, move, count in (
        (IDS[1], 'Skeleton', 'Walk', 4), (IDS[2], 'Mushroom', 'Run', 8),
        (IDS[3], 'Goblin', 'Run', 8), (IDS[4], 'Flying eye', 'Flight', 8),
    ):
        motions = {'walk': (move, count), 'attack': ('Attack', 8), 'hurt': ('Take Hit', 4), 'death': ('Death', 4)}
        if folder != 'Flying eye':
            motions = {'idle': ('Idle', 4), **motions}
        if folder == 'Skeleton':
            motions['shield'] = ('Shield', 4)
        units.append((ident, 'Fantasy ' + folder.title(), 'luizmelo_monsters_creatures_fantasy',
                      'Monsters_Creatures_Fantasy/' + folder, 150, 3, 101, False, motions))

    for ident, name, pack, subfolder, cell, scale, feet, flip, motions in units:
        folder, source = packs[pack]
        source_root = folder / 'extracted' / subfolder
        ally = ident == IDS[0]
        animations = {}
        for state, (filename, count) in motions.items():
            png = source_root / (filename + '.png')
            import struct
            size = struct.unpack('>II', png.read_bytes()[16:24])
            if size != (cell * count, cell):
                raise ValueError(f'Unexpected frame layout: {png}: {size}')
            animations[state] = dict(source_frame_size=[cell, cell], output_frame_size=[cell * scale] * 2,
                anchor=[cell * scale // 2, feet * scale], label_offset=[0, -155],
                durations=[0.1] * count, loop=state in ('idle', 'walk', 'shield'), flip_x=flip,
                layers=[dict(file=filename + '.png', row=0, columns=list(range(count)))])
        character = dict(schema_version=1, id=ident, name=name,
            faction='ALLY' if ally else 'ENEMY', type='character' if ally else 'monster',
            stats=dict(hp=100, atk=20, defense=0, attack_range=85 if ally else 95, attack_interval=1.2),
            equipment=[], behavior=dict(type='advance_and_area_attack', move_speed=72 if ally else 60,
                hit_time=0.3 if ally else 0.4, death_fade_seconds=1.0),
            animation_menu=list(animations))
        recipe = dict(source_root=source_root.relative_to(root).as_posix(), character=character,
            animations=animations, source=dict(author=source['author'], page_url=source['url'],
                license='CC0', downloaded_on=source['downloaded_on'], downloads=source['downloads']),
            notes=['Art by LuizMelo, CC0. ' + source['url'],
                   'Horizontal square cells verified against downloaded PNG dimensions.',
                   'Playback uses configured 100ms frame timing; source sheets contain no timing metadata.',
                   'Native right-facing source mirrored for ally.' if ally else
                   'Native right-facing source. Flying eye uses Flight for movement without a fabricated idle clip.'])
        (recipes / (ident + '.json')).write_text(json.dumps(recipe, indent=2) + '\n', encoding='utf-8')

    roster_path = root / 'config/gameplay/summons.json'
    roster = json.loads(roster_path.read_text())
    if not any(item['character'] == IDS[0] for item in roster):
        roster.append(dict(character=IDS[0], label='Martial Hero', cost=180, cooldown=3.6))
        roster_path.write_text(json.dumps(roster, indent=2) + '\n', encoding='utf-8')
    print('Registered:', ', '.join(IDS))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--register-only', action='store_true')
    args = parser.parse_args()
    register()
    if not args.register_only:
        subprocess.run([sys.executable, str(ROOT / 'tools/build_character_assets.py')], check=True, cwd=ROOT)
        subprocess.run(['node', str(ROOT / 'scripts/publish.mjs')], check=True, cwd=ROOT)
