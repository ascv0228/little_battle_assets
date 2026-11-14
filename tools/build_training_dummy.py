"""Offline: prepare the LPC combat dummy as an independent prop package."""
import json
from pathlib import Path
import pygame

ROOT = Path(__file__).resolve().parents[1]


def build():
    source = ROOT / 'temp_assets' / 'lpc_entry' / 'png' / 'combat_dummy' / 'BODY_animation.png'
    sheet = pygame.image.load(str(source))
    output = ROOT / 'assets' / 'props' / 'training_dummy'
    output.mkdir(parents=True, exist_ok=True)
    manifest = {'id': 'training_dummy', 'animations': {}}
    for state, columns, duration in [('idle', [0], 1.0), ('hit', [1, 2, 3, 4, 5, 6, 7, 0], 0.56)]:
        atlas = pygame.Surface((128 * len(columns), 128), pygame.SRCALPHA)
        for index, column in enumerate(columns):
            frame = sheet.subsurface((column * 64, 0, 64, 64))
            atlas.blit(pygame.transform.scale(frame, (128, 128)), (index * 128, 0))
        pygame.image.save(atlas, str(output / f'{state}.png'))
        manifest['animations'][state] = {'image': f'{state}.png', 'frame_size': [128, 128],
            'anchor': [64, 120], 'label_offset': [0, -135], 'durations': [duration / len(columns)] * len(columns), 'loop': state == 'idle'}
    (output / 'prop.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    print(f'Built training dummy in {output}')


if __name__ == '__main__':
    build()
