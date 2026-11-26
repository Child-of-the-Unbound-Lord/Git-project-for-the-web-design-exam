(function () {
  'use strict';

  // The former root URL was the workbench. Preserve bookmarked routes exactly.
  var current = new URL(window.location.href);
  if (document.body.dataset.page === 'home' && current.searchParams.has('app')) {
    var destination = new URL('app.html', current);
    destination.search = current.search;
    destination.hash = current.hash;
    window.location.replace(destination.href);
    return;
  }

  var menuButton = document.querySelector('[data-menu-toggle]');
  var menu = document.getElementById('site-nav');
  function setMenu(open) {
    if (!menuButton || !menu) return;
    menuButton.setAttribute('aria-expanded', String(open));
    menuButton.setAttribute('aria-label', open ? '关闭导航菜单' : '打开导航菜单');
    menu.classList.toggle('is-open', open);
  }
  if (menuButton && menu) {
    menuButton.addEventListener('click', function () { setMenu(menuButton.getAttribute('aria-expanded') !== 'true'); });
    menu.addEventListener('click', function (event) { if (event.target.closest('a')) setMenu(false); });
    document.addEventListener('click', function (event) { if (!event.target.closest('.site-header')) setMenu(false); });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && menuButton.getAttribute('aria-expanded') === 'true') {
        setMenu(false);
        menuButton.focus();
      }
    });
    var wideScreen = window.matchMedia('(min-width: 761px)');
    function onViewportChange(event) { if (event.matches) setMenu(false); }
    if (wideScreen.addEventListener) wideScreen.addEventListener('change', onViewportChange);
    else if (wideScreen.addListener) wideScreen.addListener(onViewportChange);
  }

  // These four scenarios are isolated teaching examples, never business writes.
  var examples = [
    { stock: 20, inbound: 20, outbound: 0, status: '库存正常', state: '', title: '第一笔库存，从入库开始。', description: '档案建立时库存为 0。登记入库 20 个后，当前库存变为 20，同时保留一条不可直接修改的入库记录。' },
    { stock: 5, inbound: 20, outbound: 15, status: '已到下限，触发预警', state: 'is-warning', title: '等于下限，也需要提醒。', description: '领用 15 个后，当前库存为 5，恰好等于预警下限。因为规则是“当前库存小于或等于下限”，这份耗材会进入预警列表。' },
    { stock: 7, inbound: 22, outbound: 15, status: '高于下限，预警解除', state: '', title: '补充入库后，状态跟着更新。', description: '新建一笔 2 个的补充入库，当前库存升至 7，高于下限 5。刷新预警列表后，提醒解除；之前的入库与领用记录仍然保留。' },
    { stock: 7, inbound: 22, outbound: 15, status: '核对一致，差额为 0', state: 'is-checked', title: '用全部历史，说明现在的库存。', description: '全部入库 20 + 2 = 22，全部领用 15，流水净额为 7。它与当前库存 7 一致，差额为 0。流水页面的日期筛选不会缩小核对范围。' }
  ];
  var tabs = Array.from(document.querySelectorAll('[data-demo-step]'));
  var panel = document.getElementById('demo-panel');
  function setText(selector, value) { var element = document.querySelector(selector); if (element) element.textContent = String(value); }
  function selectExample(index, focus) {
    var example = examples[index];
    if (!example || !panel) return;
    tabs.forEach(function (tab, position) {
      var selected = position === index;
      tab.classList.toggle('is-active', selected);
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
    });
    panel.setAttribute('aria-labelledby', tabs[index].id);
    setText('[data-demo-stock]', example.stock);
    setText('[data-demo-in]', example.inbound);
    setText('[data-demo-out]', example.outbound);
    setText('[data-demo-ledger]', example.inbound - example.outbound);
    setText('[data-demo-status]', example.status);
    setText('[data-demo-title]', example.title);
    setText('[data-demo-description]', example.description);
    var status = document.querySelector('[data-demo-state]');
    if (status) {
      status.classList.toggle('is-warning', example.state === 'is-warning');
      status.classList.toggle('is-checked', example.state === 'is-checked');
    }
    if (focus) tabs[index].focus();
  }
  tabs.forEach(function (tab, index) {
    tab.addEventListener('click', function () { selectExample(index, false); });
    tab.addEventListener('keydown', function (event) {
      var next;
      if (event.key === 'ArrowDown' || event.key === 'ArrowRight') next = (index + 1) % tabs.length;
      else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = tabs.length - 1;
      if (next !== undefined) { event.preventDefault(); selectExample(next, true); }
    });
  });

  // Keep the guide's in-page navigation usable without changing URL history.
  var tocLinks = Array.from(document.querySelectorAll('.toc a[href^="#"]'));
  function highlightToc(id) {
    tocLinks.forEach(function (link) {
      var active = link.getAttribute('href') === '#' + id;
      link.classList.toggle('is-active', active);
      if (active) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    });
  }
  if (tocLinks.length) {
    var sections = tocLinks.map(function (link) { return document.getElementById(link.getAttribute('href').slice(1)); }).filter(Boolean);
    if (sections.length) highlightToc(current.hash.slice(1) || sections[0].id);
    tocLinks.forEach(function (link) { link.addEventListener('click', function () { highlightToc(link.getAttribute('href').slice(1)); }); });
    if ('IntersectionObserver' in window) {
      var observer = new IntersectionObserver(function (entries) {
        var visible = entries.filter(function (entry) { return entry.isIntersecting; });
        if (visible.length) {
          visible.sort(function (a, b) { return a.boundingClientRect.top - b.boundingClientRect.top; });
          highlightToc(visible[0].target.id);
        }
      }, { rootMargin: '-100px 0px -65% 0px', threshold: 0 });
      sections.forEach(function (section) { observer.observe(section); });
    }
  }
})();
