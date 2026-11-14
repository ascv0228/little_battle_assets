"""Author explicit per-character recipes and register new summon offers.

Run before build_character_assets.py. No source inspection is done by the game.
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RECIPES = ROOT / 'asset_sources' / 'characters'
CHAMPIONS = (
    ('glenys', 'Glenys-the-Demonswordsman', 'Glenys', 1, 62, 1.0, 75, [('leather_coat', 4), ('demon_helm', 3)], 180),
    ('hex', 'Hex-the-Time-Witch', 'Hex', 4, 160, 1.6, 55, [('witch_hat', 1), ('witch_robe', 2)], 230),
    ('ley', 'Ley-the-Monster-Whisperer', 'Ley', 4, 140, 1.4, 65, [('travel_cloak', 3), ('circlet', 1)], 210),
    ('linail', 'Linail-the-High-Priestess', 'Linail', 4, 150, 1.5, 55, [('holy_robe', 3), ('tiara', 2)], 240),
    ('oratio', 'Oratio-the-Mercenary', 'Oratio', 1, 60, 1.0, 70, [('mercenary_armor', 7), ('steel_helmet', 3)], 190),
    ('ouzo', 'Ouzo-the-Wolf-Bard', 'Ouzo', 3, 125, 1.3, 75, [('bard_coat', 3), ('travel_hat', 1)], 200),
    ('prime', 'Prime-the-Great-Sage', 'Prime', 4, 170, 1.8, 50, [('sage_robe', 3), ('sage_hat', 1)], 260),
    ('wyvera', 'Wyvera-the-Queen-Dragoon', 'Wyvera', 0, 110, 1.2, 65, [('dragon_armor', 8), ('dragon_helm', 3)], 250),
)


def animation(file, size, columns, row, output, anchor, durations, state, label_y=-115, **layer_options):
    return {'source_frame_size': list(size), 'output_frame_size': list(output), 'anchor': list(anchor),
            'label_offset': [0, label_y], 'durations': durations, 'loop': state == 'walk',
            'layers': [{'file': file, 'columns': list(columns), 'row': row, **layer_options}]}


def character(ident, name, faction, reach, interval, speed, hit_time, gear, base_defense=0):
    return {'schema_version': 1, 'id': ident, 'name': name, 'faction': faction,
            'type': 'character' if faction == 'ALLY' else 'monster',
            'stats': {'hp': 100, 'atk': 20, 'defense': base_defense, 'attack_range': reach, 'attack_interval': interval},
            'equipment': [{'id': item, 'defense': defense} for item, defense in gear],
            'behavior': {'type': 'advance_and_area_attack', 'move_speed': speed, 'hit_time': hit_time, 'death_fade_seconds': 1.0}}


def save(data, animations, source_root, notes):
    recipe = {'source_root': source_root, 'character': data, 'animations': animations, 'notes': notes}
    (RECIPES / f'{data["id"]}.json').write_text(json.dumps(recipe, indent=2) + '\n', encoding='utf-8')


def main():
    RECIPES.mkdir(parents=True, exist_ok=True)
    offers = []
    for slug, overworld, name, attack_row, reach, interval, speed, gear, cost in CHAMPIONS:
        for variant in range(1, 4):
            suffix = '' if variant == 1 else f'-{variant}'
            ident = f'champion_{slug}' + ('' if variant == 1 else f'_v{variant}')
            title = name + ('' if variant == 1 else f' V{variant}')
            battler = f'1x-NormalSize/Battlers/{slug}-battle{suffix}.png'
            palette = {} if variant == 1 else {'palette_from': f'1x-NormalSize/Battlers/{slug}-battle.png', 'palette_to': battler}
            clips = {
                'walk': animation(f'1x-NormalSize/Overworld/{overworld}.png', (24, 24), [0, 1, 2, 1], 1, (120, 120), (60, 95), [0.14] * 4, 'walk', **palette),
                'attack': animation(battler, (32, 32), [3, 4, 5], attack_row, (96, 96), (48, 96), [0.16, 0.18, 0.18], 'attack'),
                'death': animation(battler, (32, 32), [6, 7, 8], 5, (96, 96), (48, 96), [0.18, 0.18, 0.4], 'death'),
            }
            for motion, motion_row, motion_columns in (
                ('idle', 0, [0, 1, 2]), ('ready_attack', 1, [0, 1, 2]),
                ('ready_magic', 2, [0, 1, 2]), ('block', 3, [0, 1, 2]),
                ('hurt', 4, [0, 1, 2]), ('evade', 5, [0, 1, 2]),
                ('thrust', 0, [3, 4, 5]), ('swing', 1, [3, 4, 5]),
                ('shoot', 2, [3, 4, 5]), ('skill', 3, [3, 4, 5]),
                ('cast', 4, [3, 4, 5]), ('use_item', 5, [3, 4, 5]),
                ('flee', 0, [6, 7, 8]), ('victory', 1, [6, 7, 8]),
                ('caution', 2, [6, 7, 8]), ('abnormal', 3, [6, 7, 8]),
                ('sleep', 4, [6, 7, 8]),
            ):
                clips[motion] = animation(battler, (32, 32), motion_columns, motion_row, (96, 96), (48, 96), [0.16] * 3, motion)
                clips[motion]['loop'] = motion in ('idle', 'ready_attack', 'ready_magic', 'block', 'caution', 'abnormal', 'sleep')
            save(character(ident, title, 'ALLY', reach, interval, speed, 0.18, gear), clips, 'temp_assets/Pixel_Champions_v3',
                 ['Pixel Champions by AlexDraws. 1x sheets are canonical; 3x sheets are duplicates.',
                  'Walk: overworld left-facing row. Attack: explicit SV motion row. Death: SV K/O row.',
                  'Alternate overworld sheets contain colored guide blocks; variant walks use clean base frames recolored from matching battle palettes.'])
            offers.append({'character': ident, 'label': title, 'cost': cost, 'cooldown': round(interval * 3, 1)})

    source = 'temp_assets/FreeCharactersAnimationsAssetPack'
    for folder, ident, title, faction, reach, interval, speed, gear in (
        ('Human_Soldier_Sword_Shield', 'human_steel_soldier', 'Steel Soldier', 'ALLY', 65, 1.0, 65, [('steel_helmet', 3), ('steel_armor', 5), ('steel_shield', 6)]),
        ('Monster_Slime', 'monster_slime', 'Slime', 'ENEMY', 100, 1.25, 48, []),
    ):
        path = f'SpriteSheets(96x96)/{folder}/No_Shadows/{folder}'
        pivot = (192, 232)
        clips = {}
        for state, action, count, duration in [('walk', 'Walk', 8, 0.8), ('attack', 'Attack1', 8, 0.72), ('death', 'Death', 10, 1.0)]:
            clips[state] = animation(f'{path}_{action}-Sheet.png', (96, 96), range(count), 0, (384, 384), pivot, [duration / count] * count, state, -112 if faction == 'ALLY' else -70)
        for state, action, count, duration in [('idle', 'Idle', 6, 0.6), ('hurt', 'Hurt', 4, 0.3), ('block', 'Block', 6, 0.6), ('jump_fall', 'Jump_Fall', 6, 0.6), ('attack_2', 'Attack2', 8, 0.72)]:
            clips[state] = animation(f'{path}_{action}-Sheet.png', (96, 96), range(count), 0, (384, 384), pivot, [duration / count] * count, state, -112 if faction == 'ALLY' else -70)
            clips[state]['loop'] = state == 'idle'
        for clip in clips.values():
            # The source attacks face right; allies attack towards the left.
            clip['flip_x'] = faction == 'ALLY'
        save(character(ident, title, faction, reach, interval, speed, 0.3, gear, 2 if faction == 'ENEMY' else 0), clips, source,
             ['Free Characters Animations pack. 96px canvas preserved; fourfold nearest-neighbor scale. Source body occupies a small portion of each canvas.'])
        if faction == 'ALLY':
            offers.append({'character': ident, 'label': 'Soldier', 'cost': 220, 'cooldown': 4.5})

    seeker_clips = {}
    for state, file, size, pivot, durations in (
        ('walk', 'Run_30x30_10f', (30, 30), (17, 28), [0.07] * 10),
        ('attack', 'Attack1_90x50_8f', (90, 50), (16, 38), [0.04, 0.04, 0.06, 0.04, 0.06, 0.04, 0.06, 0.08]),
        ('death', 'Death_40x50_20f', (40, 50), (20, 48), [0.1, 0.08, 0.08, 0.08, 0.1, 0.08, 0.07, 0.07, 0.07, 0.07, 0.07, 0.08, 0.08, 0.08, 0.08, 0.08, 0.08, 0.08, 0.08, 0.9]),
        ('idle', 'Idle_30x30_24f', (30, 30), (15, 28), [0.1] * 24),
        ('hurt', 'Hurt_55x80_9f', (55, 80), (26, 52), [0.04, 0.06, 0.05, 0.05, 0.05, 0.06, 0.06, 0.08, 0.1]),
        ('jump_fall', 'JumpFall_30x30_28f', (30, 30), (16, 28), [0.04] + [0.03] * 12 + [0.06, 0.06] + [0.04] * 11 + [0.06, 0.08]),
    ):
        seeker_clips[state] = animation(f'Spritesheets/Seeker_Void_{file}.png', size, range(len(durations)), 0, tuple(n * 3 for n in size), tuple(n * 3 for n in pivot), durations, state)
        seeker_clips[state]['loop'] = state in ('walk', 'idle')
    save(character('monster_hooded_seeker', 'Hooded Seeker', 'ENEMY', 100, 0.95, 85, 0.14, [('void_cloak', 3)]), seeker_clips,
         'temp_assets/Seeker_Lite', ['Character art by Primitive Pixels. Per-animation feet pivots and frame timing from Animation_Guide.txt.'])

    roster_path = ROOT / 'assets' / 'gameplay' / 'summons.json'
    roster = json.loads(roster_path.read_text(encoding='utf-8'))
    generated_ids = {o['character'] for o in offers}
    roster = [o for o in roster if o['character'] not in generated_ids] + offers
    roster_path.write_text(json.dumps(roster, indent=2) + '\n', encoding='utf-8')
    stage_path = ROOT / 'assets' / 'gameplay' / 'stages.json'
    stages = json.loads(stage_path.read_text(encoding='utf-8'))
    for stage in stages:
        stage.setdefault('enemy_opening', ['monster_slime', 'monster_hooded_seeker'])
    stage_path.write_text(json.dumps(stages, indent=2) + '\n', encoding='utf-8')
    print(f'Registered 27 independent asset recipes and {len(offers)} summon offers.')


if __name__ == '__main__':
    main()
