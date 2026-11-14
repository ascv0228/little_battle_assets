import tempfile
from pathlib import Path
import unittest
import zipfile
from prepared_bundle import pack, extract

class PreparedBundleTests(unittest.TestCase):
    def test_round_trip_excludes_raw_and_secrets(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / 'assets'
            for name in ('characters/test/idle.png', 'temp_assets/raw.png', 'characters/test/.env'):
                file = source / name
                file.parent.mkdir(parents=True, exist_ok=True)
                file.write_bytes(b'image')
            bundle = root / 'ready.zip'
            pack(bundle, source)
            extract(bundle, root / 'unpacked')
            self.assertEqual([p.relative_to(root / 'unpacked').as_posix() for p in (root / 'unpacked').rglob('*') if p.is_file()], ['characters/test/idle.png'])

    def test_invalid_archive_writes_nothing(self):
        for name in ('../outside.png', 'characters/../../outside.png', 'temp_assets/raw.png', 'characters/test/.env'):
            with self.subTest(name=name), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                bundle = root / 'bad.zip'
                with zipfile.ZipFile(bundle, 'w') as archive:
                    archive.writestr('characters/test/idle.png', b'good')
                    archive.writestr(name, b'bad')
                with self.assertRaises(ValueError):
                    extract(bundle, root / 'output')
                self.assertFalse((root / 'output').exists())

if __name__ == '__main__':
    unittest.main()
