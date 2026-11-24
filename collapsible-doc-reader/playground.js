/* 测试工作台：输入 Markdown / HTML，实时渲染成折叠阅读视图 */
(function () {
  'use strict';

  const SAMPLES = {
    basic: [
      '# 服务端接入说明',
      '',
      '把 Markdown 粘到左边，右边就是最终的折叠阅读界面。',
      '',
      '## 1. 背景',
      '',
      '现有文档以 Markdown 维护，发布后只能靠目录跳转，长文档定位成本高。',
      '',
      '### 1.1 目标',
      '',
      '- 标题可折叠，折叠即收起整棵子树',
      '- 目录与正文联动',
      '- 不引入前端框架',
      '',
      '### 1.2 非目标',
      '',
      '不做在线编辑，也不处理协同。',
      '',
      '## 2. 接口约定',
      '',
      '所有接口返回统一结构，错误码见附录。',
      '',
      '### 2.1 请求',
      '',
      '使用 `POST`，Body 为 JSON。',
      '',
      '### 2.2 响应',
      '',
      '字段与错误码见下表。',
      '',
      '| 字段 | 类型 | 说明 |',
      '| --- | --- | --- |',
      '| code | int | 0 表示成功 |',
      '| message | string | 错误描述 |',
      '',
      '## 3. 上线步骤',
      '',
      '1. 灰度 5% 流量',
      '2. 观察一天错误率',
      '3. 全量发布',
      '',
      '## 4. FAQ',
      '',
      '### 4.1 支持 Markdown 吗？',
      '',
      '支持，工作台会自动识别格式。',
    ].join('\n'),

    table: [
      '# 指标口径说明',
      '',
      '## 1. 核心指标',
      '',
      '| 指标 | 口径 | 负责人 |',
      '| --- | --- | --- |',
      '| 成功率 | 成功请求 / 总请求 | 张三 |',
      '| 耗时 P99 | 99 分位响应时间 | 李四 |',
      '',
      '## 2. 查询示例',
      '',
      '```sql',
      "select dt, count(*) as pv",
      'from dwd_page_view',
      "where dt = '2026-11-24'",
      'group by dt;',
      '```',
      '',
      '## 3. 注意事项',
      '',
      '> 口径变更必须同步到指标平台，否则下游看板会对不上。',
      '',
      '- 时间统一用北京时间自然日',
      '- 去重口径以 `uid` 为准',
      '',
      '### 3.1 常见错误',
      '',
      '把点击数当成人数，是最常见的一类错误。',
    ].join('\n'),

    nested: [
      '<h1>多层嵌套示例</h1>',
      '<p>演示 H1–H4 的层级折叠，把最大层级调到 H4 能看到完整效果。</p>',
      '<h2>一、接入</h2>',
      '<h3>1.1 准备工作</h3>',
      '<h4>1.1.1 账号</h4>',
      '<p>先开账号，再申请权限。</p>',
      '<h4>1.1.2 权限</h4>',
      '<p>权限按项目维度申请。</p>',
      '<h3>1.2 初始化</h3>',
      '<p>初始化只需要执行一次。</p>',
      '<h2>二、运行</h2>',
      '<h3>2.1 启动</h3>',
      '<p>启动后先看健康检查接口。</p>',
      '<h2>三、收尾</h2>',
      '<p>收尾阶段清理临时资源。</p>',
    ].join('\n'),

    broken: [
      '<div class="wrap">',
      '  <h1>文档标题</h1>',
      '  <div class="inner">',
      '    <h2>第二章</h2>',
      '    <p>这个标题在 <code>.inner</code> 里，和其他标题不是兄弟节点。</p>',
      '    <h3>2.1 小节</h3>',
      '    <p>切树只扫描同级兄弟，这里会断链。</p>',
      '  </div>',
      '  <h2>第三章</h2>',
      '  <p>这个标题在 <code>.wrap</code> 里。</p>',
      '</div>',
    ].join('\n'),

    empty: '',
  };

  const els = {
    source: document.getElementById('source'),
    charCount: document.getElementById('char-count'),
    formatGroup: document.getElementById('format'),
    maxLevel: document.getElementById('max-level'),
    initialState: document.getElementById('initial-state'),
    showToc: document.getElementById('show-toc'),
    live: document.getElementById('live'),
    renderBtn: document.getElementById('render'),
    samples: document.getElementById('samples'),
    modeBadge: document.getElementById('mode-badge'),
    timing: document.getElementById('timing'),
    previewBody: document.getElementById('preview-body'),
    toc: document.getElementById('preview-toc'),
    doc: document.getElementById('preview-doc'),
    stats: document.getElementById('stats'),
    diagnostics: document.getElementById('diagnostics'),
  };

  let reader = null;
  let format = 'auto';
  let timer = 0;

  /* ------------------------------ 输入解析 ------------------------------ */

  function detectFormat(text) {
    const trimmed = text.trim();
    if (!trimmed) return 'markdown';
    if (/^<(!doctype|html|body|div|section|article|h[1-6]|p|table|ul|ol|pre|blockquote|figure)/i.test(trimmed)) {
      return 'html';
    }
    if (/<h[1-6][\s>]/i.test(trimmed) && !/^#{1,6}\s/m.test(trimmed)) return 'html';
    return 'markdown';
  }

  /** 去掉脚本、事件属性与 style 标签，避免粘贴内容破坏工作台本身 */
  function sanitize(html) {
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    parsed.body.querySelectorAll('script, style, iframe, object, embed, link, meta, base').forEach((node) => node.remove());
    parsed.body.querySelectorAll('*').forEach((el) => {
      Array.from(el.attributes).forEach((attr) => {
        const name = attr.name.toLowerCase();
        const value = attr.value.trim();
        if (name.startsWith('on')) el.removeAttribute(attr.name);
        else if ((name === 'href' || name === 'src') && /^javascript:/i.test(value)) el.removeAttribute(attr.name);
      });
    });
    return parsed.body.innerHTML;
  }

  function toHtml(text) {
    const mode = format === 'auto' ? detectFormat(text) : format;
    if (mode === 'html') return { mode, html: sanitize(text) };

    if (typeof window.marked === 'undefined') {
      throw new Error('未加载 vendor/marked.min.js，Markdown 无法解析');
    }
    const raw = window.marked.parse(text, { gfm: true, breaks: false });
    return { mode, html: sanitize(raw) };
  }

  /* ------------------------------ 结构诊断 ------------------------------ */

  function diagnose(html, maxLevel) {
    const issues = [];
    const parsed = new DOMParser().parseFromString(`<div id="__root">${html}</div>`, 'text/html');
    const root = parsed.getElementById('__root');
    const headings = Array.from(root.querySelectorAll('h1,h2,h3,h4,h5,h6'));

    if (headings.length === 0) {
      issues.push({ level: 'error', text: '没有找到 h1–h6，无法生成折叠结构' });
      return issues;
    }

    const parents = new Set(headings.map((heading) => heading.parentElement));
    if (parents.size > 1) {
      issues.push({
        level: 'warn',
        text: `标题分布在 ${parents.size} 个父元素里，切树只扫描同级兄弟节点，跨容器的章节层级可能错位`,
      });
    }

    const levels = headings.map((heading) => Number(heading.tagName.slice(1)));
    const jumps = [];
    for (let i = 1; i < levels.length; i += 1) {
      if (levels[i] - levels[i - 1] > 1) jumps.push(`H${levels[i - 1]}→H${levels[i]}`);
    }
    if (jumps.length) {
      issues.push({
        level: 'info',
        text: `标题跳级 ${jumps.length} 处（${jumps.slice(0, 3).join('、')}），可以渲染，但目录缩进会跳档`,
      });
    }

    const tooDeep = levels.filter((level) => level > maxLevel).length;
    if (tooDeep) {
      issues.push({ level: 'info', text: `${tooDeep} 个标题超过最大层级 H${maxLevel}，保留为普通标题、不参与折叠` });
    }

    if (!levels.includes(1)) {
      issues.push({ level: 'info', text: '没有 H1，所有章节都是同级根节点' });
    }

    return issues;
  }

  /* ------------------------------ 渲染 ------------------------------ */

  function teardown() {
    if (reader) {
      reader.destroy();
      reader = null;
    }
  }

  function paintIssues(issues) {
    els.diagnostics.innerHTML = '';
    issues.forEach((issue) => {
      const li = document.createElement('li');
      li.className = issue.level;
      li.textContent = issue.text;
      els.diagnostics.appendChild(li);
    });
  }

  function renderEmpty(message) {
    teardown();
    els.doc.innerHTML = `<div class="pg-empty">${message}</div>`;
    els.toc.innerHTML = '';
    els.modeBadge.textContent = '–';
    els.timing.textContent = '';
    els.stats.textContent = '等待输入…';
    els.diagnostics.innerHTML = '';
  }

  function showError(message) {
    teardown();
    els.doc.innerHTML = `<div class="pg-empty">${message}</div>`;
    els.toc.innerHTML = '';
    els.modeBadge.textContent = '–';
    els.timing.textContent = '';
    els.stats.textContent = '渲染失败';
    paintIssues([{ level: 'error', text: message }]);
  }

  function render() {
    const text = els.source.value;
    els.charCount.textContent = `${text.length} 字`;

    if (!text.trim()) {
      renderEmpty('把 Markdown 或 HTML 粘贴到左侧，预览会出现在这里。');
      return;
    }

    const started = performance.now();

    let parsed;
    try {
      parsed = toHtml(text);
    } catch (error) {
      showError(String(error.message || error));
      return;
    }

    teardown();
    els.doc.innerHTML = parsed.html;
    els.toc.innerHTML = '';
    els.modeBadge.textContent = parsed.mode === 'html' ? 'HTML' : 'Markdown';

    const previewBody = els.previewBody;
    const showToc = els.showToc.checked;
    previewBody.classList.toggle('no-toc', !showToc);

    const maxLevel = Number(els.maxLevel.value);
    const issues = diagnose(parsed.html, maxLevel);

    const hasHeading = els.doc.querySelector('h1,h2,h3,h4,h5,h6');
    if (hasHeading) {
      reader = new window.FoldingReader(els.doc, {
        toc: showToc ? '#preview-toc' : null,
        maxLevel,
        persist: false,
      });

      const initial = els.initialState.value;
      if (initial === 'collapsed') reader.collapseAll();
      else if (initial === 'depth2') reader.expandToDepth(2);
    }

    const ms = Math.round(performance.now() - started);
    const sections = els.doc.querySelectorAll('.rf-section').length;
    const headingList = Array.from(els.doc.querySelectorAll('h1,h2,h3,h4,h5,h6'));
    const byLevel = [1, 2, 3, 4, 5, 6]
      .map((level) => ({
        level,
        count: headingList.filter((heading) => Number(heading.tagName.slice(1)) === level).length,
      }))
      .filter((item) => item.count > 0)
      .map((item) => `H${item.level}×${item.count}`)
      .join(' ');

    els.timing.textContent = `${ms} ms`;
    els.stats.textContent = [
      `标题 ${headingList.length} 个（${byLevel || '0'}）`,
      `可折叠 ${sections} 个`,
      `渲染 ${ms} ms`,
    ].join(' · ');

    paintIssues(issues);
  }

  function scheduleRender() {
    clearTimeout(timer);
    timer = setTimeout(render, 220);
  }

  /* ------------------------------ 事件 ------------------------------ */

  els.source.addEventListener('input', () => {
    els.charCount.textContent = `${els.source.value.length} 字`;
    if (els.live.checked) scheduleRender();
  });

  els.formatGroup.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-format]');
    if (!button) return;
    format = button.dataset.format;
    els.formatGroup.querySelectorAll('button').forEach((item) => {
      item.classList.toggle('is-active', item === button);
    });
    render();
  });

  [els.maxLevel, els.initialState, els.showToc].forEach((control) => {
    control.addEventListener('change', render);
  });

  els.renderBtn.addEventListener('click', render);

  els.samples.addEventListener('change', () => {
    els.source.value = SAMPLES[els.samples.value] || '';
    els.charCount.textContent = `${els.source.value.length} 字`;
    render();
  });

  els.source.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      render();
    }
  });

  /* 初始内容 */
  els.source.value = SAMPLES.basic;
  els.charCount.textContent = `${els.source.value.length} 字`;
  render();
})();
