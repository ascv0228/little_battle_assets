"""Preview generated atlas packages without importing the client repository."""
import json
import os
from pathlib import Path
os.environ.setdefault('SDL_VIDEODRIVER', 'dummy')
os.environ.setdefault('SDL_AUDIODRIVER', 'dummy')
import pygame

ROOT = Path(__file__).resolve().parents[1]


def main():
    pygame.init()
    try:
        pygame.display.set_mode((1, 1))
        definitions = []
        for file in sorted((ROOT / 'assets' / 'characters').glob('*/character.json')):
            data = json.loads(file.read_text(encoding='utf-8'))
            if data['id'].startswith('champion_') and not data['id'].endswith(('_v2', '_v3')) or data['id'] in ('human_steel_soldier', 'monster_slime', 'monster_hooded_seeker', 'monster_minotaur', 'monster_mushroom'):
                definitions.append((file.parent, data))
        rows = (len(definitions) + 2) // 3
        canvas = pygame.Surface((1140, 56 + rows * 218))
        canvas.fill((29, 43, 48))
        font, small = pygame.font.Font(None, 25), pygame.font.Font(None, 19)
        canvas.blit(font.render('OTHER ASSETS / prepared character packages', True, (244, 230, 179)), (22, 16))
        for index, (folder, data) in enumerate(definitions):
            x, y = 14 + index % 3 * 376, 56 + index // 3 * 218
            pygame.draw.rect(canvas, (44, 63, 68), (x, y, 362, 204), border_radius=9)
            canvas.blit(font.render(data['name'], True, (235, 236, 219)), (x + 12, y + 12))
            stats = data['stats']
            caption = f'HP {stats["hp"]} ATK {stats["atk"]} DEF {stats["defense"]} R{stats["attack_range"]} / {stats["attack_interval"]}s'
            canvas.blit(small.render(caption, True, (143, 202, 187)), (x + 12, y + 39))
            for column, state in enumerate(('walk', 'attack', 'death')):
                spec = data['animations'][state]
                width, height = spec['frame_size']
                atlas = pygame.image.load(str(folder / spec['image']))
                frame = atlas.subsurface((len(spec['durations']) // 2 * width, 0, width, height))
                picture = frame.subsurface(frame.get_bounding_rect())
                ratio = min(95 / picture.get_width(), 85 / picture.get_height())
                picture = pygame.transform.scale(picture, (max(1, round(picture.get_width() * ratio)), max(1, round(picture.get_height() * ratio))))
                center = x + 61 + column * 120
                canvas.blit(picture, (center - picture.get_width() / 2, y + 155 - picture.get_height()))
                caption = small.render(f'{state} / {len(spec["durations"])}f', True, (190, 203, 199))
                canvas.blit(caption, (center - caption.get_width() / 2, y + 170))
        output = ROOT / 'data' / 'previews' / 'other-assets.png'
        output.parent.mkdir(parents=True, exist_ok=True)
        pygame.image.save(canvas, str(output))
        print(f'Previewed {len(definitions)} character packages: {output}')
    finally:
        pygame.quit()


if __name__ == '__main__':
    main()
