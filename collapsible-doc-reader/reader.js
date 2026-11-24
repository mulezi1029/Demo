/*!
 * FoldingReader — 飞书风格的标题折叠阅读器（零依赖）
 *
 * 用法：
 *   const reader = new FoldingReader('#doc', { toc: '#toc', searchInput: '#search' });
 *
 * 思路与飞书文档一致：把线性的 HTML 标题切成嵌套 section，
 * 折叠 = section 上的一个状态类，目录是同一棵树的另一个视图。
 */
(function (global) {
  'use strict';

  const HEADING = 'h1,h2,h3,h4,h5,h6';
  const HEADING_RE = /^H[1-6]$/;
  const levelOf = (el) => Number(el.tagName.slice(1));

  /** 标题的纯文本（去掉挂在标题里的操作按钮） */
  function headingText(heading) {
    const clone = heading.cloneNode(true);
    clone.querySelectorAll('.rf-controls').forEach((node) => node.remove());
    return clone.textContent.replace(/\s+/g, ' ').trim();
  }

  class FoldingReader {
    constructor(root, options = {}) {
      this.root = typeof root === 'string' ? document.querySelector(root) : root;
      if (!this.root) throw new Error(`FoldingReader: 找不到容器 ${root}`);

      const { toc, searchInput } = options;
      this.tocRoot = typeof toc === 'string' ? document.querySelector(toc) : toc || null;
      this.searchInput = typeof searchInput === 'string' ? document.querySelector(searchInput) : searchInput || null;

      this.storageKey = options.storageKey || `rf:${document.title || location.pathname}`;
      this.minLevel = options.minLevel || 1;
      this.maxLevel = options.maxLevel || 3;

      this.meta = new WeakMap();      // section -> { heading, level }
      this.sections = [];             // 按文档顺序
      this.tocNodes = new Map();      // section -> { li, row, toggle, sublist }
      this.activeSection = null;
      this.searchHits = 0;
      this.uid = 0;

      this.build();
      this.renderToc();
      this.restore();
      this.bindShortcuts();
      this.watchScroll();
    }

    /* ------------------------------ 结构层 ------------------------------ */

    build() {
      const headings = Array.from(this.root.querySelectorAll(HEADING))
        .filter((heading) => {
          const level = levelOf(heading);
          return level >= this.minLevel && level <= this.maxLevel;
        });

      // 从最深层往上处理：包浅层标题时，深层的 section 已经建好，会被整体收进 body
      headings
        .slice()
        .sort((a, b) => levelOf(b) - levelOf(a))
        .forEach((heading) => {
          const level = levelOf(heading);

          const section = document.createElement('section');
          section.className = 'rf-section';
          section.dataset.level = String(level);

          const body = document.createElement('div');
          body.className = 'rf-body';
          const inner = document.createElement('div');
          inner.className = 'rf-body-inner';
          body.appendChild(inner);

          heading.replaceWith(section);
          section.appendChild(heading);
          section.appendChild(body);

          // 标题 "拥有" 它之后、下一个同级或更高级标题之前的所有节点
          let node = section.nextSibling;
          while (node) {
            if (node.nodeType === 1 && HEADING_RE.test(node.tagName) && levelOf(node) <= level) break;
            const next = node.nextSibling;
            inner.appendChild(node);
            node = next;
          }

          if (!heading.id) heading.id = `rf-h${++this.uid}`;
          this.meta.set(section, { heading, level });
          this.sections.push(section);
          this.decorate(section, heading);
        });

      // build 期间是按层级处理的，这里恢复成文档顺序
      this.sections.sort((a, b) =>
        a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
      );
    }

    decorate(section, heading) {
      // 标题文本包一层：操作按钮占用标题右侧的空间，不再靠负偏移伸到容器外，
      // 否则会被 .rf-body-inner 的 overflow: hidden 裁掉
      const title = document.createElement('span');
      title.className = 'rf-title';
      while (heading.firstChild) title.appendChild(heading.firstChild);
      heading.appendChild(title);

      const controls = document.createElement('div');
      controls.className = 'rf-controls';

      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'rf-toggle';
      toggle.setAttribute('aria-expanded', 'true');
      toggle.setAttribute('aria-label', '折叠本节');
      toggle.title = '折叠 / 展开';
      toggle.innerHTML =
        '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">' +
        '<path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" ' +
        'stroke-linecap="round" stroke-linejoin="round"/></svg>';

      const copy = document.createElement('button');
      copy.type = 'button';
      copy.className = 'rf-copy';
      copy.title = '复制本节全部内容';
      copy.setAttribute('aria-label', '复制本节');
      copy.innerHTML =
        '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">' +
        '<path d="M6 2.5h6a1 1 0 011 1v6M3.5 5h6a1 1 0 011 1v6a1 1 0 01-1 1h-6a1 1 0 01-1-1V6a1 1 0 011-1z" ' +
        'fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>';

      controls.append(toggle, copy);
      heading.appendChild(controls);

      toggle.addEventListener('click', (event) => {
        event.stopPropagation();
        this.toggle(section);
      });
      copy.addEventListener('click', (event) => {
        event.stopPropagation();
        this.copySection(section);
      });
      heading.addEventListener('dblclick', () => this.toggle(section));
    }

    /* ------------------------------ 折叠状态 ------------------------------ */

    toggle(section, collapsed, silent) {
      const next = typeof collapsed === 'boolean'
        ? collapsed
        : !section.classList.contains('is-collapsed');

      section.classList.toggle('is-collapsed', next);

      const button = section.querySelector('.rf-toggle');
      if (button) {
        button.setAttribute('aria-expanded', String(!next));
        button.setAttribute('aria-label', next ? '展开本节' : '折叠本节');
      }

      // 目录联动是单向的：正文折叠会强制目录节点折叠，反之不会
      this.collapseTocNode(section, next, true);

      if (!silent) this.persist();
      return next;
    }

    expandAll() {
      this.sections.forEach((section) => this.toggle(section, false, true));
      this.persist();
    }

    collapseAll() {
      this.sections.forEach((section) => this.toggle(section, true, true));
      this.persist();
    }

    /** 保留到第 depth 级标题，更深的收起 */
    expandToDepth(depth) {
      this.sections.forEach((section) => {
        this.toggle(section, Number(section.dataset.level) > depth, true);
      });
      this.persist();
    }

    /** 展开整条祖先链（点目录、搜索命中、锚点跳转都要用） */
    reveal(section) {
      let current = section;
      while (current && current !== this.root) {
        if (current.classList && current.classList.contains('rf-section')) {
          this.toggle(current, false, true);
        }
        current = current.parentElement;
      }
      this.persist();
    }

    /* ------------------------------ 目录层 ------------------------------ */

    renderToc() {
      if (!this.tocRoot) return;
      this.tocRoot.textContent = '';
      const list = document.createElement('ul');
      list.className = 'rf-toc-list';
      this.tocRoot.appendChild(list);
      this.walkToc(this.root, list);
    }

    walkToc(host, list) {
      Array.from(host.children).forEach((child) => {
        if (!child.classList || !child.classList.contains('rf-section')) return;
        const meta = this.meta.get(child);
        if (!meta) return;

        const li = document.createElement('li');
        li.className = 'rf-toc-item';
        li.dataset.level = String(meta.level);

        const row = document.createElement('div');
        row.className = 'rf-toc-row';

        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'rf-toc-toggle';
        toggle.setAttribute('aria-expanded', 'true');
        toggle.setAttribute('aria-label', '折叠目录节点');
        toggle.innerHTML =
          '<svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">' +
          '<path d="M4 2l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.4" ' +
          'stroke-linecap="round" stroke-linejoin="round"/></svg>';

        const link = document.createElement('a');
        link.className = 'rf-toc-link';
        link.href = `#${meta.heading.id}`;
        link.textContent = headingText(meta.heading);

        row.append(toggle, link);
        li.appendChild(row);

        const sublist = document.createElement('ul');
        sublist.className = 'rf-toc-sublist';
        li.appendChild(sublist);

        list.appendChild(li);
        this.tocNodes.set(child, { li, row, toggle, sublist });

        toggle.addEventListener('click', (event) => {
          event.stopPropagation();
          this.collapseTocNode(child, !li.classList.contains('is-collapsed'));
        });

        link.addEventListener('click', (event) => {
          event.preventDefault();
          this.reveal(child);
          meta.heading.scrollIntoView({ behavior: 'smooth', block: 'start' });
          history.replaceState(null, '', `#${meta.heading.id}`);
        });

        const inner = child.querySelector(':scope > .rf-body > .rf-body-inner');
        if (inner) this.walkToc(inner, sublist);

        if (sublist.children.length === 0) {
          sublist.remove();
          toggle.classList.add('is-leaf');
        }
      });
    }

    collapseTocNode(section, collapsed, silent) {
      const node = this.tocNodes.get(section);
      if (!node) return;
      node.li.classList.toggle('is-collapsed', collapsed);
      node.sublist.hidden = collapsed;
      node.toggle.setAttribute('aria-expanded', String(!collapsed));
      node.toggle.setAttribute('aria-label', collapsed ? '展开目录节点' : '折叠目录节点');
      if (!silent) this.persist();
    }

    /* ------------------------------ 搜索 ------------------------------ */

    bindShortcuts() {
      document.addEventListener('keydown', (event) => {
        const mod = event.metaKey || event.ctrlKey;
        if (mod && event.key.toLowerCase() === 'f' && this.searchInput) {
          event.preventDefault();
          this.searchInput.focus();
          this.searchInput.select();
        }
        if (event.key === 'Escape' && document.activeElement === this.searchInput) {
          this.searchInput.value = '';
          this.clearSearch();
        }
      });
    }

    /** 返回命中数量；命中项的祖先链会自动展开（对应飞书 ⌘F 展开折叠标题） */
    search(term) {
      this.clearSearch();
      const query = (term || '').trim();
      if (!query) return 0;

      const walker = document.createTreeWalker(this.root, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) => {
          if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
          if (node.parentElement.closest('.rf-controls')) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        },
      });

      const batch = [];
      while (walker.nextNode()) batch.push(walker.currentNode);

      const needle = query.toLowerCase();
      let first = null;

      batch.forEach((node) => {
        const index = node.nodeValue.toLowerCase().indexOf(needle);
        if (index === -1) return;

        const range = document.createRange();
        range.setStart(node, index);
        range.setEnd(node, index + query.length);

        const mark = document.createElement('mark');
        mark.className = 'rf-hit';
        try {
          range.surroundContents(mark);
        } catch (error) {
          return; // 跨元素边界的文本节点直接跳过
        }

        this.searchHits += 1;
        this.reveal(mark.closest('.rf-section') || this.root);
        if (!first) first = mark;
      });

      if (first) first.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return this.searchHits;
    }

    clearSearch() {
      this.root.querySelectorAll('mark.rf-hit').forEach((mark) => {
        const parent = mark.parentNode;
        if (!parent) return;
        while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
        parent.removeChild(mark);
        parent.normalize();
      });
      this.searchHits = 0;
    }

    /* ------------------------------ 复制 ------------------------------ */

    async copySection(section) {
      const clone = section.cloneNode(true);
      clone.classList.remove('is-collapsed');
      clone.querySelectorAll('.rf-controls').forEach((node) => node.remove());
      clone.style.cssText = 'position:fixed;left:-10000px;top:0;width:60ch;';
      document.body.appendChild(clone);
      const text = (clone.innerText || clone.textContent || '').trim();
      clone.remove();

      try {
        await navigator.clipboard.writeText(text);
        this.toast('已复制本节内容');
      } catch (error) {
        const area = document.createElement('textarea');
        area.value = text;
        area.style.cssText = 'position:fixed;left:-10000px;top:0;';
        document.body.appendChild(area);
        area.select();
        try {
          document.execCommand('copy');
          this.toast('已复制本节内容');
        } catch (fallbackError) {
          this.toast('复制失败，请手动选择');
        }
        area.remove();
      }
    }

    toast(message) {
      let el = document.querySelector('.rf-toast');
      if (!el) {
        el = document.createElement('div');
        el.className = 'rf-toast';
        document.body.appendChild(el);
      }
      el.textContent = message;
      el.classList.add('is-visible');
      clearTimeout(this.toastTimer);
      this.toastTimer = setTimeout(() => el.classList.remove('is-visible'), 1600);
    }

    /* ------------------------------ 持久化 ------------------------------ */

    pathOf(section) {
      const names = [];
      let current = section;
      while (current && current !== this.root) {
        if (current.classList && current.classList.contains('rf-section')) {
          const meta = this.meta.get(current);
          if (meta) names.unshift(headingText(meta.heading));
        }
        current = current.parentElement;
      }
      return names.join(' / ');
    }

    persist() {
      try {
        const collapsed = this.sections
          .filter((section) => section.classList.contains('is-collapsed'))
          .map((section) => this.pathOf(section));

        const tocCollapsed = [];
        this.tocNodes.forEach((node, section) => {
          if (node.li.classList.contains('is-collapsed')) tocCollapsed.push(this.pathOf(section));
        });

        localStorage.setItem(this.storageKey, JSON.stringify({ collapsed, tocCollapsed }));
      } catch (error) {
        /* 隐私模式 / file:// 限制下静默降级，不影响阅读 */
      }
    }

    restore() {
      let saved = null;
      try {
        saved = JSON.parse(localStorage.getItem(this.storageKey) || 'null');
      } catch (error) {
        saved = null;
      }
      if (!saved) return;

      const byPath = new Map();
      this.sections.forEach((section) => byPath.set(this.pathOf(section), section));

      (saved.collapsed || []).forEach((path) => {
        const section = byPath.get(path);
        if (section) this.toggle(section, true, true);
      });
      (saved.tocCollapsed || []).forEach((path) => {
        const section = byPath.get(path);
        if (section) this.collapseTocNode(section, true, true);
      });
    }

    reset() {
      try {
        localStorage.removeItem(this.storageKey);
      } catch (error) {
        /* 忽略 */
      }
      this.expandAll();
    }

    /* ------------------------------ 滚动定位 ------------------------------ */

    watchScroll() {
      if (!('IntersectionObserver' in window)) return;
      this.observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const section = entry.target.closest('.rf-section');
          if (section) this.setActive(section);
        });
      }, { rootMargin: '-14% 0px -72% 0px', threshold: 0 });

      this.sections.forEach((section) => {
        const meta = this.meta.get(section);
        if (meta) this.observer.observe(meta.heading);
      });
    }

    setActive(section) {
      if (this.activeSection === section) return;

      if (this.activeSection) {
        const previous = this.tocNodes.get(this.activeSection);
        if (previous) previous.row.classList.remove('is-active');
      }
      this.activeSection = section;

      const node = this.tocNodes.get(section);
      if (!node) return;
      node.row.classList.add('is-active');

      // 让当前条目在目录里保持可见
      let current = section.parentElement;
      while (current && current !== this.root) {
        if (current.classList && current.classList.contains('rf-section')) {
          this.collapseTocNode(current, false, true);
        }
        current = current.parentElement;
      }
    }
  }

  global.FoldingReader = FoldingReader;
})(window);
