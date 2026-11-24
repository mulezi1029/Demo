# FoldingReader · 飞书式折叠阅读器

一个零依赖的静态 demo：把普通的 **HTML（或 Markdown 渲染结果）** 变成可折叠的阅读视图，交互对齐飞书文档的「章节标题折叠」。

- 标题右侧有折叠 / 复制按钮（默认淡显，悬停变清晰），折叠即收起整棵子树
- 左侧目录与正文是同一棵树：正文折叠会同步目录，目录折叠只影响目录、不动正文
- ⌘F / Ctrl+F 唤起正文搜索，命中项自动展开被折叠的祖先章节
- 折叠状态按「标题文本链」存 localStorage，刷新后保持
- 全部展开 / 只展开到 H2 / 全部折叠（示例扩展，飞书本身没有）
- 浅色 / 深色跟随系统，窄屏目录变抽屉
- 自带测试工作台：左侧粘贴 Markdown / HTML，右侧实时出折叠视图，带结构诊断

## 跑起来

不需要构建，不需要依赖：

```bash
# 方式一：直接双击 index.html（示例文档）或 playground.html（测试工作台）

# 方式二：起个静态服务（想用 ?src= 加载外部 HTML 时需要）
python3 -m http.server 8000
# 打开 http://localhost:8000/
```

## 测试工作台

`playground.html` 用来验证任意文档的折叠效果：

- 左边粘贴 **Markdown** 或 **HTML**，格式默认自动识别，也可以手动锁定
- 右边实时渲染，可以把 `最大层级` / `初始状态` / `目录` 逐项切换对比
- 底部显示标题数量、可折叠章节数、渲染耗时，以及结构诊断：
  - 标题分散在多个父容器里（切树会断链）
  - 标题层级跳级
  - 标题层级超过 `maxLevel`，不参与折叠
  - 完全没有标题

用 `?src=` 换成你自己的文档：

```
http://localhost:8000/?src=path/to/your-doc.html
```

> `file://` 下浏览器禁止 `fetch` 本地文件，所以双击打开时只能用页面内联的源文档；
> 想换成自己的 HTML，把 `<template id="doc-source">` 里的内容替换掉，或走 http 环境。

## 目录结构

```
collapsible-doc-reader/
├── index.html        # demo 页面 + 内联的示例文档（<template id="doc-source">）
├── reader.js         # 组件本体：切树 / 折叠 / 目录 / 搜索 / 持久化
├── reader.css        # 组件样式（标题按钮、折叠动画、目录、高亮）
├── demo.css          # demo 页面样式（顶栏、侧边栏、正文排版、深浅色）
├── demo.js           # demo 胶水：加载源、初始化、工具栏、进度条
├── playground.html   # 测试工作台：左输入右预览
├── playground.css    # 工作台布局样式
├── playground.js     # 工作台逻辑：解析、诊断、渲染
├── vendor/
│   └── marked.min.js # Markdown 解析器（仅工作台使用，MIT）
├── docs/
│   └── implementation.md  # 实现原理 + 9 张 Mermaid 图
└── README.md
```

## 接入到自己的页面

```html
<link rel="stylesheet" href="reader.css">

<nav id="toc"></nav>
<article id="doc"><!-- 你的 HTML 或 Markdown 渲染结果 --></article>

<script src="reader.js"></script>
<script>
  const reader = new FoldingReader('#doc', {
    toc: '#toc',              // 目录容器，可省略（省略则不生成目录）
    searchInput: '#search',   // 传了就接管 ⌘F / Ctrl+F，可省略
    storageKey: 'my-doc',     // localStorage 键，默认按页面标题
    minLevel: 1,              // 参与折叠的标题范围
    maxLevel: 3,              // 默认只折叠 H1–H3
  });
</script>
```

公开 API：

| 方法 | 说明 |
| --- | --- |
| `toggle(section, [collapsed])` | 折叠 / 展开某个 section |
| `expandAll()` / `collapseAll()` | 全部展开 / 全部折叠 |
| `expandToDepth(n)` | 只保留到第 n 级标题，更深的收起 |
| `reveal(section)` | 展开整条祖先链 |
| `search(term)` | 高亮命中并展开祖先，返回命中数 |
| `clearSearch()` | 清除高亮 |
| `reset()` | 清掉本地状态并全部展开 |

## 实现要点

1. **切树**：从最深的标题往上处理，把「标题 + 其后的兄弟节点」包进
   `<section class="rf-section">`，浅层标题自然会收进深层 section，嵌套不用额外维护。
2. **折叠**：`section.is-collapsed` 一个类 + grid 行高过渡，不猜 `max-height`。
3. **目录**：由同一棵树生成，父节点折叠时子节点靠 CSS 自然隐藏；额外的 JS 只处理
   飞书的单向规则——正文折叠强制目录折叠，目录折叠不影响正文。
4. **持久化**：存的键是「标题文本链」而不是自增 id，内容增删时不会错位。

当前 Demo 用 `h1`–`h6` 识别标题；这只是输入约定，不是折叠机制的限制。详见[标题识别与章节归属](./docs/implementation.md#标题识别与章节归属)。[实现原理全文](./docs/implementation.md)另有 9 张 Mermaid 图，涵盖切树、折叠状态、目录和搜索等流程。

## 与飞书文档的行为对照

| 行为 | 飞书 | 本项目 |
| --- | --- | --- |
| 标题右侧的折叠按钮 | ✅（左侧） | ✅（右侧） |
| 折叠隐藏整棵子树 | ✅ | ✅ |
| 目录随正文折叠 | ✅ | ✅ |
| 目录折叠不影响正文 | ✅ | ✅ |
| 折叠状态持久化 | ✅（块属性 `folded`） | ✅（localStorage） |
| 搜索自动展开折叠章节 | ✅ | ✅（自建搜索框） |
| 复制折叠章节全部内容 | ✅ | ✅（纯文本） |
| 一键折叠 / 展开全部 | ❌ | ✅（示例扩展） |
| 协同编辑 / 评论 / 块拖拽 | ✅ | ❌（只读场景） |

## 已知限制

- 标题和所属正文可以共用外层 `<div>` 或 `<article>`，但切树只扫描同一父容器里的兄弟节点，不跨容器归组。目录仍能穿过包装层找到已生成的章节。
- Markdown 解析用的是工作台里 vendor 的 `marked`（MIT），只服务于演示页面；
  `reader.js` 本身不依赖任何第三方库。
- 工作台会对粘贴内容做一次轻量净化：移除 `<script>` / `<style>` / `<iframe>` 与 `on*` 事件属性，
  避免内容影响工作台自身；需要验证这些标签的渲染效果，请改用 `index.html?src=`。
- 搜索目前每个文本节点只高亮第一处命中，长段落内多次出现只标一处。
- 折叠内容在打印预览中默认隐藏，`demo.js` 里用 `beforeprint` 自动全部展开；
  接入方如果自己控制打印，记得调 `expandAll()`。
- 只读场景。需要边写边折、多人协同，应该用 Tiptap 这类编辑器内核，而不是本组件。

## License

MIT
