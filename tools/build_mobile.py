"""Build the static mobile app from the current shared frontend."""
from argparse import ArgumentParser
from hashlib import sha256
import json
from pathlib import Path
from shutil import copyfile
from tempfile import TemporaryDirectory

ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / '练习前端'
MOBILE = ROOT / 'mobile'
APP_FILES = ('index.html', 'study.css', 'profile.js', 'study.js', 'knowledge.js',
             'progress.js', 'grading.js', '题库.js', '知识库.js')
MOBILE_FILES = ('manifest.webmanifest', 'register.js', 'sw.js',
                'icons/app-180.png', 'icons/app-192.png', 'icons/app-512.png',
                'icons/app-maskable-512.png')
HEAD = '''  <meta name="theme-color" content="#113a34">
  <link rel="manifest" href="manifest.webmanifest">
  <link rel="apple-touch-icon" href="icons/app-180.png">
  <script defer src="register.js"></script>
'''


def copy_asset(source, relative, target):
    path = target / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    copyfile(source / relative, path)


def figure_paths():
    script = (FRONTEND / '题库.js').read_text(encoding='utf-8-sig').strip()
    prefix = 'window.questionBank = '
    if not script.startswith(prefix) or not script.endswith(';'):
        raise ValueError('题库.js 的格式不正确。')
    questions = json.loads(script[len(prefix):-1])
    figures = set()
    for question in questions:
        for image in question['images']:
            path = Path(image['path'])
            if path.parts[:2] != ('练习前端', '题图') or len(path.parts) != 3:
                raise ValueError(f'不支持的题图位置 {path}')
            figures.add(Path(*path.parts[1:]))
    return sorted(figures)


def write_mobile(target):
    figures = figure_paths()
    for relative in (*APP_FILES, *figures):
        copy_asset(FRONTEND, relative, target)
    for relative in MOBILE_FILES:
        copy_asset(MOBILE, relative, target)
    # The mobile app stores its activity in browser local storage.
    (target / 'profile-boot.js').write_text('window.studyDiskSeed = null;\n', encoding='utf-8')
    index = target / 'index.html'
    markup = index.read_text(encoding='utf-8').replace(' · 本地预览</title>', '</title>')
    if '</head>' not in markup or 'id="preference-note"' not in markup:
        raise ValueError('网页入口缺少手机版所需的头部或设置区。')
    markup = markup.replace('</head>', HEAD + '</head>', 1)
    markup = markup.replace('      <p id="preference-note"',
                            '      <p id="offline-status" class="scope" role="status" hidden></p>\n'
                            '      <p id="preference-note"', 1)
    index.write_text(markup, encoding='utf-8', newline='\n')
    assets = sorted(path for path in target.rglob('*') if path.is_file())
    cache_files = [path for path in assets if path.name != 'sw.js']
    content = {'version': sha256(b''.join(
        path.relative_to(target).as_posix().encode('utf-8') + b'\0' + sha256(path.read_bytes()).digest()
        for path in assets)).hexdigest()[:20],
        'paths': [path.relative_to(target).as_posix() for path in cache_files]}
    (target / 'offline-assets.js').write_text('const offlineBuild = ' + json.dumps(content, ensure_ascii=True) + ';\n',
                                               encoding='utf-8', newline='\n')
    return len(figures), len(content['paths'])


def main():
    parser = ArgumentParser(description='打包可通过静态 HTTPS 部署的昆医349手机版。')
    parser.add_argument('output', type=Path, help='尚未存在的输出目录')
    args = parser.parse_args()
    output = args.output.resolve()
    if output.exists():
        parser.error(f'输出目录已存在：{output}')
    output.parent.mkdir(parents=True, exist_ok=True)
    with TemporaryDirectory(prefix='kunming349-', dir=output.parent) as tmp:
        staged = Path(tmp) / 'mobile'
        staged.mkdir()
        count, assets = write_mobile(staged)
        staged.rename(output)
    print(f'手机版已生成。{count} 张题图，{assets} 个离线资源。')
    print(output)


if __name__ == '__main__':
    main()
