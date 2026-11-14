"""Offline only: compile explicit recipes to self-contained character packages."""
import argparse
import json
import os
from collections import Counter, defaultdict
from pathlib import Path

os.environ.setdefault('SDL_VIDEODRIVER', 'dummy')
import pygame

ROOT = Path(__file__).resolve().parents[1]


def build(recipe_path, source_root, output_root):
    recipe = json.loads(recipe_path.read_text(encoding='utf-8'))
    source_root = source_root or ROOT / recipe.get('source_root', 'temp_assets/lpc_entry/png')
    manifest = recipe['character']
    gear_defense = sum(item['defense'] for item in manifest['equipment'])
    manifest['defense_breakdown'] = {'base': manifest['stats']['defense'], 'equipment': gear_defense}
    manifest['stats']['defense'] += gear_defense
    manifest['animations'] = {}
    manifest['asset_notes'] = recipe.get('notes', [])
    destination = output_root / manifest['id']
    destination.mkdir(parents=True, exist_ok=True)
    for state, spec in recipe['animations'].items():
        count = len(spec['durations'])
        width, height = spec['output_frame_size']
        sw, sh = spec['source_frame_size']
        atlas = pygame.Surface((width * count, height), pygame.SRCALPHA)
        loaded = [(pygame.image.load(str(source_root / layer['file'])), layer) for layer in spec['layers']]
        for sheet, layer in loaded:
            if 'palette_from' in layer:
                original = pygame.image.load(str(source_root / layer['palette_from']))
                replacement = pygame.image.load(str(source_root / layer['palette_to']))
                if original.get_size() != replacement.get_size():
                    raise ValueError('Palette reference sheets must have matching dimensions')
                votes = defaultdict(Counter)
                for y in range(original.get_height()):
                    for x in range(original.get_width()):
                        old, new = original.get_at((x, y)), replacement.get_at((x, y))
                        if old.a and new.a:
                            votes[tuple(old[:3])][tuple(new[:3])] += 1
                colors = {color: counts.most_common(1)[0][0] for color, counts in votes.items()}
                for y in range(sheet.get_height()):
                    for x in range(sheet.get_width()):
                        pixel = sheet.get_at((x, y))
                        if pixel.a and tuple(pixel[:3]) in colors:
                            sheet.set_at((x, y), (*colors[tuple(pixel[:3])], pixel.a))
        for sheet, layer in loaded:
            if len(layer['columns']) != count:
                raise ValueError(f'{recipe_path}: {state} layer has wrong frame count')
            for column in layer['columns']:
                if column < 0 or (column + 1) * sw > sheet.get_width() or (layer['row'] + 1) * sh > sheet.get_height():
                    raise ValueError(f'{recipe_path}: {state} frame outside source sheet')
        for index in range(count):
            frame = pygame.Surface((sw, sh), pygame.SRCALPHA)
            for sheet, layer in loaded:
                frame.blit(sheet, (0, 0), (layer['columns'][index] * sw, layer['row'] * sh, sw, sh))
            if spec.get('flip_x', False):
                frame = pygame.transform.flip(frame, True, False)
            atlas.blit(pygame.transform.scale(frame, (width, height)), (index * width, 0))
        pygame.image.save(atlas, str(destination / f'{state}.png'))
        manifest['animations'][state] = {
            'image': f'{state}.png', 'frame_size': [width, height], 'anchor': spec['anchor'],
            'label_offset': spec['label_offset'], 'durations': spec['durations'], 'loop': spec['loop'],
        }
    for alias, target in recipe.get('animation_aliases', {}).items():
        manifest['animations'][alias] = manifest['animations'][target]
    (destination / 'character.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, help='Override recipe source root (normally set per package)')
    parser.add_argument('--recipes', type=Path, default=ROOT / 'asset_sources' / 'characters')
    parser.add_argument('--output', type=Path, default=ROOT / 'assets' / 'characters')
    args = parser.parse_args()
    recipes = sorted(args.recipes.glob('*.json'))
    if not recipes:
        raise ValueError('No character recipes found')
    for recipe in recipes:
        build(recipe, args.source, args.output)
    print(f'Built {len(recipes)} independent character packages in {args.output}')


if __name__ == '__main__':
    main()
