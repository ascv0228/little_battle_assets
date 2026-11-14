"""Explicit Minotaur and Mushroom frame maps, stats and enemy registration."""
import json
import sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from tools.register_other_assets import animation, character, save


def main():
    minotaur = {}
    motions = [('idle', 'Idle', 0, 5, 0.6), ('move', 'Move', 1, 8, 0.72),
            ('taunt', 'Taunt', 2, 5, 0.6), ('attack_1', 'Attack1', 3, 9, 0.9),
            ('attack_2', 'Attack2', 4, 5, 0.6), ('attack_3', 'Attack3', 5, 6, 0.8),
            ('attack_4', 'Attack4', 6, 9, 0.9), ('damage_1', 'Damage1', 7, 3, 0.3),
            ('damage_2', 'Damage2', 8, 3, 0.3), ('death', 'Death', 9, 6, 0.9)]
    for state, label, row, count, seconds in motions:
        minotaur[state] = animation('Minotaur - Sprite Sheet.png', (96, 96), range(count), row,
            (288, 288), (144, 192), [seconds / count] * count, state, -150)
        minotaur[state]['loop'] = state in ('idle', 'move')
    definition = character('monster_minotaur', 'Minotaur', 'ENEMY', 105, 1.5, 50, 0.35,
                           [('leather_harness', 4), ('iron_bracers', 4)])
    definition['animation_menu'] = [state for state, *_ in motions]
    definition['animation_labels'] = {state: label for state, label, *_ in motions}
    save(definition, minotaur, 'temp_assets/Minotaur',
         ['96px cells. Only native right-facing rows 0..9 are compiled, matching other enemies.',
          'Motion order: Idle, Move, Taunt, Attack1, Attack2, Attack3, Attack4, Damage1, Damage2, Death.',
          'Battle walk aliases Move; default battle attack aliases Attack1. No roar or jump motion is inferred.'])
    recipe_path = ROOT / 'asset_sources/characters/monster_minotaur.json'
    recipe = json.loads(recipe_path.read_text(encoding='utf-8'))
    recipe['animation_aliases'] = {'walk': 'move', 'attack': 'attack_1'}
    recipe_path.write_text(json.dumps(recipe, indent=2) + '\n', encoding='utf-8')
    mushroom = {}
    for state, action, count, seconds in [('walk', 'Run', 8, 0.8), ('attack', 'Attack', 10, 0.8),
            ('death', 'Die', 15, 1.2), ('idle', 'Idle', 7, 0.7), ('hurt', 'Hit', 5, 0.4),
            ('stun', 'Stun', 18, 1.2), ('attack_2', 'AttackWithStun', 24, 1.6)]:
        mushroom[state] = animation(f'Mushroom with VFX/Mushroom-{action}.png', (80, 64), range(count), 0,
            (160, 128), (80, 128), [seconds / count] * count, state, -95)
        mushroom[state]['loop'] = state in ('idle', 'walk', 'stun')
    save(character('monster_mushroom', 'Mushroom', 'ENEMY', 100, 1.2, 60, 0.32, [], 3),
         mushroom, 'temp_assets/Forest_Monsters_FREE/Mushroom',
         ['80x64 cells, VFX edition. Native right-facing sprites. Stun and alternate attack are registered animations; current battle uses area damage, not a stun status.'])
    stage_path = ROOT / 'assets/gameplay/stages.json'
    stages = json.loads(stage_path.read_text(encoding='utf-8'))
    for stage in stages:
        opening = stage.setdefault('enemy_opening', [])
        for ident in ('monster_mushroom', 'monster_minotaur'):
            if ident not in opening:
                opening.append(ident)
    stage_path.write_text(json.dumps(stages, indent=2) + '\n', encoding='utf-8')
    print('Registered Minotaur and Mushroom recipes, plus enemy opening entries.')


if __name__ == '__main__':
    main()
