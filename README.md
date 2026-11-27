# 昆医 349 药学综合刷题系统

面向**昆明医科大学 349 药学综合自命题**的本地刷题工具，覆盖**药理学、药物化学、药剂学、药物分析**四科，适合按教材章节刷题、组卷和整理复习记录。

这是我备考时赶工做的自用系统。这次整理的是多智能体协作前的版本。公开仓库提供程序和少量自编样题，正式练习内容由你自己收集、整理并导入。欢迎 fork、修改并做成自己的独立版本。后续我计划重做题库导入和科目配置，支持个人直接上传资料，逐步适配更多专业课。

## 安装与启动

1. 在 GitHub 点击 **Code → Download ZIP** 并解压，或使用 `git clone https://github.com/Aniyasama-hub/kmmu349pass.git`。
2. Windows 安装 **Python 3.10 或更新版本**，确保 `py` 或 `python` 可在终端使用。浏览器建议使用近期版本的 Edge 或 Chrome。
3. 双击 `启动题库.cmd`。也可以在项目根目录执行 `python -X utf8 local_study.py`，然后打开 `http://127.0.0.1:8949/`。

Python 后端使用标准库。前端是原生 HTML、CSS 和 JavaScript，无需安装 pip 包、Node.js 或数据库。直接打开 `练习前端/index.html` 也能试用，学习数据保存在当前浏览器的本地存储。

在 Windows 以外的系统可尝试 Python 命令启动。此版的启动器及完整流程在 Windows 上验证。若本机已有另一套题库运行，使用 `--port 8950` 开新端口。

## 系统结构

| 文件或模块 | 用途 |
| --- | --- |
| `启动题库.cmd`、`local_study.py` | 启动回环 HTTP 服务，提供本机学习档案读写接口 |
| `练习前端/index.html`、`study.css` | 模式菜单、筛选、题目区、答案与笔记区及自适应布局 |
| `练习前端/study.js` | 管理精选、强化、冲刺模拟、按年真题训练及作答流程 |
| `练习前端/grading.js`、`progress.js` | 客观题评分、主观题采分点匹配、进度和断点续做 |
| `练习前端/knowledge.js` | 搜索知识词条、查看关联药物及收藏 |
| `练习前端/profile.js`、`profile-boot.js` | 管理浏览器状态与本机档案同步，静态入口为空种子 |
| `练习前端/题库.js`、`知识库.js` | 前端读取的题目与词条数据，仓库内为自编演示 |
| `examples/`、`tools/prepare_bank.py` | JSON 示例和本地题库准备工具 |

答题时可查看答案解析、确认选项、标记「不会」、收藏及写笔记。模拟支持随机抽题和限时，真题训练按数据里的年份和顺序出题。客观题与主观题分别统计，错题、笔记与断点保存在本机。

## 使用自己的资料

先将自己的题目整理为 UTF-8 JSON。参考 [题目示例](examples/题目元信息.json) 和 [词条示例](examples/知识词条.json)。本版读取结构化题库，PDF、Word 的自动拆题与上传界面是下一版计划。

```powershell
python -X utf8 tools/prepare_bank.py "D:/我的资料/题目元信息.json" --terms "D:/我的资料/知识词条.json"
```

生成后打开 `.local/昆医349/启动题库.cmd`。词条 JSON 可省略。题图可放在题目文件旁的 `题图/` 或 `练习前端/题图/`。题图位于其他目录时，用 `--assets` 指定所在的资料根目录。要保留旧导入结果时，使用 `--output .local/另一套题库` 生成到新目录。

- **题目**使用稳定的 `id`，填写 `subject`、`chapter`、`type`、`stem` 和 `source`。`source.kind` 可填 `practice`、`exam` 或 `recall`。真题和回忆题需有 `source.year`。若希望同一年的原卷顺序稳定，建议提供 `source.order`。
- **客观题**用 `options` 存原字母和文本，`correct` 填正确字母数组，例如 `["A", "C"]`。主观题使用 `answer`，并可填写 `rubric.points` 作为采分点。
- **知识导航**使用单独的词条 JSON，含词条名、别名、章节、分段定义及出处。关联药物可通过现有词条 ID 互相跳转。

## 本机学习记录

用启动器进入时，Windows 默认将记录写入 `%LOCALAPPDATA%\Kunming349\profile.json`。错题、收藏、笔记、考试日期、历史作答和统计由每位用户的设备自行保存。直接打开 HTML 时使用当前浏览器存储。齿轮菜单可导出和导入个人备份。要隔离多个题库的记录，可同时指定独立的端口和 `--profile` 路径，例如 `python -X utf8 local_study.py --port 8950 --profile .local/另一套-profile.json`。

公开仓库中的样题仅用于演示操作，只有自带真题数据时才会在真题训练中显示年份。欢迎围绕资料导入、题库结构和多科适配提交改进或维护自己的分支。
