/* Demo 页面胶水：加载源 HTML、初始化阅读器、连接顶栏控件 */
(function () {
  'use strict';

  const UI_KEY = 'rf:ui:toc-hidden';

  /** 源：默认取页面内联的模板块，也可用 ?src=path/to/doc.html 覆盖（需 http 环境） */
  async function loadSource() {
    const src = new URLSearchParams(location.search).get('src');
    if (!src) {
      return document.getElementById('doc-source').innerHTML;
    }
    const response = await fetch(src);
    if (!response.ok) throw new Error(`加载 ${src} 失败：HTTP ${response.status}`);
    const parsed = new DOMParser().parseFromString(await response.text(), 'text/html');
    return parsed.body.innerHTML;
  }

  function bindToolbar(reader) {
    document.querySelectorAll('.presets button').forEach((button) => {
      button.addEventListener('click', () => {
        const action = button.dataset.action;
        if (action === 'expand-all') reader.expandAll();
        else if (action === 'collapse-all') reader.collapseAll();
        else if (action === 'expand-depth') reader.expandToDepth(Number(button.dataset.depth || 2));
      });
    });

    const tocButton = document.getElementById('toggle-toc');
    tocButton.addEventListener('click', () => {
      const hidden = document.body.classList.toggle('rf-toc-hidden');
      try {
        localStorage.setItem(UI_KEY, hidden ? '1' : '0');
      } catch (error) {
        /* 忽略 */
      }
    });
  }

  function bindSearch(reader) {
    const input = document.getElementById('search');
    const placeholder = input.placeholder;
    let timer = 0;

    input.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const term = input.value.trim();
        if (!term) {
          reader.clearSearch();
          input.placeholder = placeholder;
          return;
        }
        const hits = reader.search(term);
        input.placeholder = hits > 0 ? `命中 ${hits} 处` : '没有匹配内容';
      }, 160);
    });

    input.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        input.value = '';
        reader.clearSearch();
        input.placeholder = placeholder;
        input.blur();
      }
    });
  }

  function bindProgress() {
    const bar = document.getElementById('progress');
    const update = () => {
      const scrollable = document.documentElement.scrollHeight - window.innerHeight;
      const ratio = scrollable > 0 ? window.scrollY / scrollable : 0;
      bar.style.width = `${Math.min(100, Math.max(0, ratio * 100))}%`;
    };
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    update();
  }

  function openHash(reader) {
    if (!location.hash) return;
    const heading = document.getElementById(location.hash.slice(1));
    if (!heading) return;
    const section = heading.closest('.rf-section');
    if (section) reader.reveal(section);
    requestAnimationFrame(() => heading.scrollIntoView({ block: 'start' }));
  }

  async function main() {
    const container = document.getElementById('doc');
    try {
      container.innerHTML = await loadSource();
    } catch (error) {
      container.innerHTML =
        '<h1>源文件加载失败</h1><p>' + String(error.message || error) +
        '</p><p>直接用 <code>?src=</code> 加载需要 http 环境，例如 ' +
        '<code>python3 -m http.server</code>。</p>';
      return;
    }

    let tocHidden = false;
    try {
      tocHidden = localStorage.getItem(UI_KEY) === '1';
    } catch (error) {
      tocHidden = false;
    }
    if (tocHidden) document.body.classList.add('rf-toc-hidden');

    const reader = new window.FoldingReader('#doc', {
      toc: '#toc',
      searchInput: '#search',
      storageKey: 'rf:demo:collapsible-doc-reader',
      maxLevel: 3,
    });

    window.reader = reader; // 方便在控制台里试 API
    bindToolbar(reader);
    bindSearch(reader);
    bindProgress();
    openHash(reader);

    // 打印时把折叠全部展开，避免输出残缺
    window.addEventListener('beforeprint', () => reader.expandAll());
  }

  main();
})();
