# HTML PRD Skill

产品需求管理 Skill，支持 App / Web PRD 编写与维护，生成包含导航、原型和需求说明的三栏式 HTML 文档，区分全新页面与页面修改，并提供结构校验。

## 能力

- **左侧导航**：需求标题、分组及页面清单，底部显示创建与更新时间。
- **中间工作区**：手机或网页原型外框，不限制产品页面内部结构；仅需求说明模式保持空白。
- **右侧需求说明**：全新页面使用精简九段式；页面修改只写涉及的变更章节，保留原序号。
- **需求维护**：处理业务基线、冲突确认、跨页面影响和评审后变更。
- **静态校验**：检查本地链接、重复 ID、内联脚本语法、占位内容和需求章节结构。

写作原则：**逻辑完整、语言简练，同一规则只写一次。**

## 使用方式

本仓库根目录就是 skill 目录，入口为 `SKILL.md`。可按所用 AI 工具的技能加载方式安装，或让助手读取该文件并按其中的引用继续工作；具体兼容性取决于工具对 Skill 格式和本地脚本执行的支持。

Skill 内部名称为 `manage-product-requirements`，与 GitHub 仓库名不同。`agents/openai.yaml` 是可选的工具适配元数据，不是核心规范的依赖。

示例请求：

> 为登录流程编写 App 需求，包含可交互原型和完整需求说明。
>
> 修改现有页面的筛选规则，只说明变更点，并检查关联页面是否需要同步。

## 脚手架与检查

需要 Node.js。以下命令在仓库根目录执行，输出路径替换为实际项目路径。

```bash
node scripts/scaffold_page.mjs \
  --output /absolute/path/page.html \
  --platform app \
  --mode prototype \
  --document page \
  --page-type new \
  --title "登录页面" \
  --project-title "账号登录需求"
```

- `--platform`：`app` 或 `web`。
- `--mode`：`prototype` 或 `requirements`（仅需求说明）。
- `--page-type`：`new`（默认，全新页面）或 `change`（页面修改）。

脚手架仅生成草稿，需按实际需求补齐内容和交互。修改型草稿只添加涉及变更的章节；不要用脚手架覆盖已有完整需求。更多参数见 `references/delivery-modes.md`。

```bash
# 草稿静态检查
node scripts/validate_project.mjs /absolute/path/to/project

# 交付前检查占位内容及章节结构
node scripts/validate_project.mjs /absolute/path/to/project --strict

# 脚本回归测试
node --test tests/scripts.test.mjs
```

静态检查不能替代业务逻辑审查和浏览器交互验收。

## 目录

- `SKILL.md`：工作流程与入口规范。
- `references/`：需求结构、交付模式、依据优先级和验收规范。
- `assets/`：HTML 外壳、原型展示容器与需求说明模板。
- `scripts/`：页面生成与项目校验脚本。
- `tests/`：脚本回归测试。
- `agents/`：可选的工具适配元数据。
