"""Pack game-ready assets for CI, or extract a validated prepared bundle."""
import argparse
from pathlib import Path, PurePosixPath
import stat
import zipfile

ROOT = Path(__file__).resolve().parents[1]
GROUPS = {'characters', 'gameplay', 'props', 'credits'}
EXTENSIONS = {'.png', '.json', '.md', '.txt'}

def allowed(name):
    parts = name.split('/')
    return (len(parts) >= 2 and parts[0] in GROUPS
            and all(p and not p.startswith('.') for p in parts)
            and not any(c in name for c in ('\\', ':', '%', '\x00'))
            and PurePosixPath(name).suffix.lower() in EXTENSIONS)

def pack(bundle, assets):
    bundle.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(bundle, 'w', zipfile.ZIP_DEFLATED) as archive:
        for file in sorted(assets.rglob('*')):
            if file.is_symlink():
                raise ValueError('Symbolic links are not game assets')
            if file.is_file() and allowed(file.relative_to(assets).as_posix()):
                archive.write(file, file.relative_to(assets).as_posix())

def extract(bundle, assets):
    with zipfile.ZipFile(bundle) as archive:
        entries = archive.infolist()
        names = [entry.filename for entry in entries]
        if len(entries) > 20000 or len(set(names)) != len(names):
            raise ValueError('Too many or duplicate entries')
        if sum(entry.file_size for entry in entries) > 512 * 1024 * 1024:
            raise ValueError('Bundle too large')
        for entry in entries:
            if (not allowed(entry.filename) or entry.flag_bits & 1
                    or stat.S_ISLNK(entry.external_attr >> 16)
                    or entry.file_size > 128 * 1024 * 1024):
                raise ValueError('Unsafe prepared asset entry: ' + entry.filename)
            target = assets.joinpath(*entry.filename.split('/')).resolve()
            if not target.is_relative_to(assets.resolve()):
                raise ValueError('Asset escapes output directory')
        for entry in entries:
            target = assets.joinpath(*entry.filename.split('/'))
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(archive.read(entry))

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=('pack', 'extract'))
    parser.add_argument('bundle', type=Path)
    parser.add_argument('--assets', type=Path, default=ROOT / 'assets')
    args = parser.parse_args()
    globals()[args.action](args.bundle, args.assets)
