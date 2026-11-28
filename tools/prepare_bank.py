from argparse import ArgumentParser
import json
from pathlib import Path, PurePosixPath
import re
import shutil
from tempfile import TemporaryDirectory


ROOT = Path(__file__).resolve().parents[1]
FRONTEND = '练习前端'
SUBJECTS = {'药理学', '药物化学', '药剂学', '药物分析'}
SOURCE_KINDS = {'practice', 'exam', 'recall'}


def read_rows(path):
    rows = json.loads(path.read_text(encoding='utf-8-sig'))
    if not isinstance(rows, list) or not all(isinstance(row, dict) for row in rows):
        raise ValueError(f'{path.name} 必须是由对象组成的 JSON 数组。')
    ids = [row.get('id') for row in rows]
    if any(not isinstance(value, str) or not re.fullmatch(r'[\w-]+', value) for value in ids):
        raise ValueError(f'{path.name} 的 id 只能含字母、数字、短横线或下划线。')
    if len(set(ids)) != len(ids):
        raise ValueError(f'{path.name} 含重复 id。')
    return rows


def image_reference(value):
    if not isinstance(value, str):
        raise ValueError('题图路径必须是字符串。')
    relative = PurePosixPath(value.replace('\\', '/'))
    if relative.is_absolute() or '..' in relative.parts or ':' in value:
        raise ValueError(f'题图须位于资料根目录下：{value}')
    if relative.parts and relative.parts[0] == FRONTEND:
        relative = PurePosixPath(*relative.parts[1:])
    if len(relative.parts) < 2 or relative.parts[0] != '题图':
        raise ValueError(f'题图路径应以 题图/ 或 练习前端/题图/ 开头：{value}')
    return relative


def question_rows(path):
    rows = read_rows(path)
    for row in rows:
        qid = row['id']
        if row.get('subject') not in SUBJECTS or not all(
            isinstance(row.get(key), str) and row[key].strip() for key in ('chapter', 'type', 'stem')
        ):
            raise ValueError(f'{qid} 缺少支持的科目、章节、题型或题干。')
        source = row.get('source')
        if not isinstance(source, dict) or source.get('kind') not in SOURCE_KINDS or not source.get('label'):
            raise ValueError(f'{qid} 缺少有效的 source.kind 或 source.label。')
        if source['kind'] in {'exam', 'recall'} and not re.fullmatch(r'\d{4}', str(source.get('year', ''))):
            raise ValueError(f'{qid} 的真题或回忆题须填写四位年份。')
        row.setdefault('answer', '')
        for field in ('options', 'topics', 'images', 'analysis'):
            if not isinstance(row.setdefault(field, []), list):
                raise ValueError(f'{qid} 的 {field} 须为数组。')
        if not isinstance(row['answer'], str) or not all(isinstance(topic, str) for topic in row['topics']):
            raise ValueError(f'{qid} 的答案和考点必须使用文本。')
        if not all(isinstance(opt, dict) and re.fullmatch('[A-H]', str(opt.get('label', '')))
                   and isinstance(opt.get('text'), str) for opt in row['options']):
            raise ValueError(f'{qid} 的选项须含 label 和 text。')
        labels = {opt['label'] for opt in row['options']}
        answer = row.get('correct')
        if len(labels) != len(row['options']) or (answer is not None and (
            not isinstance(answer, list) or not all(isinstance(label, str) and label in labels for label in answer)
        )):
            raise ValueError(f'{qid} 的选项字母重复，或 correct 与选项不一致。')
    return rows


def knowledge_rows(path):
    if not path:
        return []
    rows = read_rows(path)
    for row in rows:
        if not isinstance(row.get('name'), str) or not row['name'].strip() or row.get('kind') not in {'药物', '名词'}:
            raise ValueError(f"{row['id']} 须填写词条名称及类型。")
        for field in ('aliases', 'sections', 'sources', 'related'):
            if not isinstance(row.setdefault(field, []), list):
                raise ValueError(f"{row['id']} 的 {field} 须为数组。")
    return rows


def write_script(path, variable, rows):
    path.write_text(f'window.{variable} = '+json.dumps(rows, ensure_ascii=True, separators=(',', ':'))+';\n', encoding='utf-8')


def prepare(questions_file, terms_file, assets, target):
    questions = question_rows(questions_file)
    terms = knowledge_rows(terms_file)
    if target.exists():
        raise ValueError(f'目标目录已存在，请另选一个目录：{target}')
    target.parent.mkdir(parents=True, exist_ok=True)
    asset_root = (assets or questions_file.parent).resolve()
    with TemporaryDirectory(dir=target.parent) as workspace:
        app = Path(workspace) / 'app'
        frontend = app / FRONTEND
        shutil.copytree(ROOT / FRONTEND, frontend)
        for name in ('local_study.py', '启动题库.cmd'):
            shutil.copy2(ROOT / name, app / name)
        for directory in ('windows', 'mobile'):
            shutil.copytree(ROOT / directory, app / directory)
        (app / 'tools').mkdir()
        shutil.copy2(ROOT / 'tools' / 'build_mobile.py', app / 'tools' / 'build_mobile.py')
        for row in questions:
            for image in row['images']:
                if not isinstance(image, dict) or image.get('section') not in {'stem', 'answer'}:
                    raise ValueError(f"{row['id']} 的题图 section 应为 stem 或 answer。")
                relative = image_reference(image.get('path'))
                paths = [asset_root / FRONTEND / relative, asset_root / relative]
                source = next((path.resolve() for path in paths
                               if path.resolve().is_relative_to(asset_root) and path.is_file()), None)
                if source is None:
                    raise ValueError(f"{row['id']} 找不到题图 {relative}。")
                destination = frontend / relative
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(source, destination)
                image['path'] = f'{FRONTEND}/{relative.as_posix()}'
        write_script(frontend / '题库.js', 'questionBank', questions)
        write_script(frontend / '知识库.js', 'knowledgeCatalog', terms)
        app.rename(target)
    print(f'已导入 {len(questions)} 道题、{len(terms)} 条词条。')
    print(target / '启动题库.cmd')


def main():
    parser = ArgumentParser(description='用自己的结构化 JSON 创建本地可运行的昆医349目录。')
    parser.add_argument('questions', type=Path, help='题目元信息 JSON')
    parser.add_argument('--terms', type=Path, help='知识词条 JSON')
    parser.add_argument('--assets', type=Path, help='原始题图根目录，默认与题目 JSON 同目录')
    parser.add_argument('--output', type=Path, default=ROOT / '.local' / '昆医349', help='新生成的目录')
    args = parser.parse_args()
    try:
        prepare(args.questions, args.terms, args.assets, args.output.resolve())
    except (OSError, ValueError) as error:
        parser.exit(1, f'{error}\n')


if __name__ == '__main__':
    main()
