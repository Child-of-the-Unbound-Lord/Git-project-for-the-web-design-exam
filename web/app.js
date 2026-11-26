(function () {
  'use strict';

  var root = document.getElementById('app');
  var modalRoot = document.getElementById('modal-root');
  var toastRoot = document.getElementById('toast-root');
  var API = window.LabAPI;
  var data = null;
  var mode = 'browser';
  var cloudMode = false;
  var setupState = null;
  var standaloneMode = document.documentElement.dataset.standalone === 'true';
  var route = readRoute();
  var busy = false;
  var reconciliation = null;
  var modalFocus = null;
  var pageSize = 12;
  var pages = {};
  var filters = {
    items: { q: '', active: 'all' },
    inventory: { q: '', status: 'all' },
    movements: { q: '', type: '', item_id: '', start: '', end: '', recipient_id: '' },
    alerts: { q: '', status: 'all' },
    statistics: { start: '', end: '' }
  };
  var drafts = { IN: newDraft('IN'), OUT: newDraft('OUT') };
  var apps = [
    { id: 'items', title: '耗材档案', desc: '维护名称、单位与存放位置', icon: 'box', group: '业务操作' },
    { id: 'inbound', title: '入库登记', desc: '记录到货，增加可用库存', icon: 'in', admin: true },
    { id: 'outbound', title: '领用登记', desc: '关联领用人，记录每次使用', icon: 'out', admin: true },
    { id: 'inventory', title: '库存查询', desc: '快速查找耗材与剩余数量', icon: 'layers', group: '查询与分析' },
    { id: 'movements', title: '出入库流水', desc: '追溯每一笔库存变化', icon: 'list' },
    { id: 'alerts', title: '低库存预警', desc: '掌握临界库存与补充需求', icon: 'bell', admin: true },
    { id: 'reconciliation', title: '库存核对', desc: '使用全部历史流水核对库存', icon: 'shield', admin: true },
    { id: 'statistics', title: '数据统计', desc: '查看真实业务记录与使用分布', icon: 'chart' },
    { id: 'users', title: '成员管理', desc: '创建账号、停用成员和重设密码', icon: 'user', admin: true, cloudOnly: true }
  ];
  var paths = {
    home: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    box: '<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="M3 8v9l9 5 9-5V8M12 13v9M7.5 5.5l9 5"/>',
    in: '<path d="M4 4h5M4 4v16h16v-5M13 3v12m-4-4 4 4 4-4M16 4h4v5"/>',
    out: '<path d="M4 4h5M4 4v16h16v-5M13 15V3m-4 4 4-4 4 4M16 20h4"/>',
    layers: '<path d="m12 3 10 5-10 5L2 8l10-5Zm-9 9 9 5 9-5M3 16l9 5 9-5"/>',
    list: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M9 8h7M9 12h7M9 16h7M7 8h.01M7 12h.01M7 16h.01"/>',
    bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>',
    shield: '<path d="m12 3 9 4v5c0 5-5 8-9 10-4-2-9-5-9-10V7l9-4Z"/><path d="m8 12 3 3 5-6"/>',
    chart: '<path d="M4 3v17h17M8 15V9M13 15V5M18 15v-4"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
    refresh: '<path d="M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12-2l2 3M4 16l2 3a7 7 0 0 0 12-2"/>',
    logout: '<path d="M9 4H4v16h5M10 12h11m-4-4 4 4-4 4"/>',
    arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
    download: '<path d="M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
    close: '<path d="m6 6 12 12M6 18 18 6"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/>',
    eye: '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    edit: '<path d="m15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-4-4L5 15l-1 5ZM13 20h8"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
    chevron: '<path d="m9 5 7 7-7 7"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 8a2.5 2.5 0 1 1 4 2c-1 .7-1.5 1-1.5 3M12 17h.01"/>'
  };

  function esc(value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function (s) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[s]; }); }
  function icon(name) { return '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">' + (paths[name] || paths.box) + '</svg>'; }
  function n(value) { return Number(value || 0); }
  function number(value) { return n(value).toLocaleString('zh-CN'); }
  function admin() { return Boolean(data && data.user && data.user.role === 'admin'); }
  function readRoute() { var id = new URL(window.location.href).searchParams.get('app') || 'home'; return /^(home|items|inbound|outbound|inventory|movements|alerts|reconciliation|statistics|users)$/.test(id) ? id : 'home'; }
  function currentApp() { return apps.find(function (a) { return a.id === route; }); }
  function dateKey(value) {
    var d = new Date(value); if (isNaN(d.getTime())) return '';
    var p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
    var parts = {}; p.forEach(function (x) { parts[x.type] = x.value; }); return parts.year + '-' + parts.month + '-' + parts.day;
  }
  function dateTime(value) { var d = new Date(value); return isNaN(d.getTime()) ? '—' : new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(d); }
  function today() { return dateKey(new Date()); }
  function itemById(id) { return data.items.find(function (x) { return x.id === id; }); }
  function userName(id) { var u = data.users.find(function (x) { return x.id === id; }); return u ? (u.display_name || u.username) : (id ? '未提供身份信息' : '—'); }
  function newDraft(type) { var suffix = window.crypto && window.crypto.randomUUID ? window.crypto.randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase() : Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 7).toUpperCase(); return { type: type, business_no: type + '-' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + '-' + suffix, item_id: '', quantity: '', recipient_id: '', note: '', posted: null }; }
  function selected(value, target) { return String(value) === String(target) ? ' selected' : ''; }
  function option(value, label, current) { return '<option value="' + esc(value) + '"' + selected(value, current) + '>' + esc(label) + '</option>'; }
  function badge(label, color) { return '<span class="badge ' + (color || '') + '"><span class="dot"></span>' + esc(label) + '</span>'; }
  function stockBadge(item) { if (!item.active) return badge('已停用', ''); if (item.current_stock === 0) return badge('库存耗尽', 'red'); if (item.current_stock < item.min_stock) return badge('低于下限', 'amber'); if (item.current_stock === item.min_stock) return badge('已到下限', 'amber'); return badge('库存正常', 'green'); }
  function lowItems() { return data.items.filter(function (x) { return x.active && x.current_stock <= x.min_stock; }); }
  function sortedMovements() { return data.movements.slice().sort(function (a, b) { return new Date(b.created_at).getTime() - new Date(a.created_at).getTime() || String(b.id).localeCompare(String(a.id)); }); }
  function matching(text, q) { return String(text || '').toLocaleLowerCase().indexOf(String(q || '').trim().toLocaleLowerCase()) !== -1; }
  function note(text, kind, glyph) { return '<div class="notice ' + (kind || '') + '">' + icon(glyph || 'info') + '<div>' + text + '</div></div>'; }
  function button(label, action, glyph, type, extra) { return '<button type="button" class="btn ' + (type || '') + '" data-action="' + esc(action) + '" ' + (extra || '') + '>' + (glyph ? icon(glyph) : '') + label + '</button>'; }
  function navButton(label, target, glyph, type) { return '<a href="?app=' + esc(target) + '" class="btn ' + (type || '') + '" data-nav="' + esc(target) + '">' + (glyph ? icon(glyph) : '') + label + '</a>'; }
  function heading(title, subtitle, actions) { return '<div class="page-heading"><div><h1>' + title + '</h1><p>' + subtitle + '</p></div>' + (actions ? '<div class="heading-actions">' + actions + '</div>' : '') + '</div>'; }
  function kpi(label, value, unit, glyph, color, foot) { return '<div class="kpi"><div class="kpi-top"><span>' + label + '</span><span class="kpi-icon ' + (color || '') + '">' + icon(glyph) + '</span></div><div class="kpi-value">' + number(value) + '<span>' + unit + '</span></div><p class="kpi-note">' + foot + '</p></div>'; }
  function empty(title, description, glyph, action) { return '<div class="empty-state"><div class="empty-icon">' + icon(glyph || 'box') + '</div><h3>' + title + '</h3><p>' + description + '</p>' + (action || '') + '</div>'; }
  function table(headers, rows, compact) { return '<div class="table-scroll ' + (compact || '') + '"><table><thead><tr>' + headers.map(function (h) { return '<th' + (h[1] ? ' class="' + h[1] + '"' : '') + '>' + h[0] + '</th>'; }).join('') + '</tr></thead><tbody>' + rows.join('') + '</tbody></table></div>'; }
  function paginated(items, row, headers, key, emptyTitle, emptyText) {
    var total = Math.max(1, Math.ceil(items.length / pageSize)); pages[key] = Math.min(Math.max(1, pages[key] || 1), total);
    var html = items.length ? table(headers, items.slice((pages[key] - 1) * pageSize, pages[key] * pageSize).map(row)) : empty(emptyTitle || '没有找到符合条件的记录', emptyText || '试试清空关键词或调整筛选条件。', 'search');
    return html + '<div class="table-bottom"><span>共 ' + number(items.length) + ' 条记录' + (items.length ? ' · 每页最多 ' + pageSize + ' 条' : '') + '</span><div class="pagination"><button class="btn small" data-action="page" data-key="' + key + '" data-step="-1"' + (pages[key] <= 1 ? ' disabled' : '') + '>上一页</button><span>' + pages[key] + ' / ' + total + '</span><button class="btn small" data-action="page" data-key="' + key + '" data-step="1"' + (pages[key] >= total ? ' disabled' : '') + '>下一页</button></div></div>';
  }
  function searchField(value, placeholder) { return '<div class="filter-field search"><label for="filter-q">关键词</label><div class="search-wrap">' + icon('search') + '<input id="filter-q" name="q" value="' + esc(value) + '" placeholder="' + esc(placeholder) + '" maxlength="120"></div></div>'; }
  function selectField(name, label, values, current, small) { return '<div class="filter-field ' + (small ? 'small' : '') + '"><label for="filter-' + name + '">' + label + '</label><select id="filter-' + name + '" name="' + name + '">' + values.map(function (x) { return option(x[0], x[1], current); }).join('') + '</select></div>'; }
  function dateFields(f) { return '<div class="filter-field small"><label for="filter-start">开始日期（上海）</label><input type="date" id="filter-start" name="start" value="' + esc(f.start) + '"></div><div class="filter-field small"><label for="filter-end">结束日期（上海）</label><input type="date" id="filter-end" name="end" value="' + esc(f.end) + '"></div>'; }
  function filterEnd(key) { return '<div class="filter-actions"><button type="submit" class="btn primary">筛选</button><button type="button" class="btn ghost" data-action="clear-filter" data-key="' + key + '">重置</button></div></form>'; }
  function itemCell(x) { return '<div class="item-cell"><span class="item-avatar">' + icon('box') + '</span><div><div class="cell-main">' + esc(x.name) + '</div><div class="cell-sub">' + esc(x.code) + (x.spec ? ' · ' + esc(x.spec) : '') + '</div></div></div>'; }
  function modeDescription() { return cloudMode ? '<strong>云端共享模式</strong> · 数据保存在 Cloudflare D1；所有成员使用同一套库存，权限由服务器检查。' : mode === 'server' ? '<strong>本机服务模式</strong> · 数据保存在当前 Python 服务的数据库中，账号权限由服务端验证。' : '<strong>当前浏览器演示模式</strong> · 数据仅保存在此浏览器，角色切换为演示；完整的服务端权限验证请运行本机 Python 版本。'; }

  function websiteLink(extraClass) { return standaloneMode ? '' : '<a class="site-home-link ' + esc(extraClass || '') + '" href="index.html">网站首页</a>'; }

  function renderLogin(message) {
    document.body.classList.remove('sidebar-open');
    root.innerHTML = '<div class="login-shell"><section class="login-brand-panel"><div class="brand"><div class="brand-symbol">' + icon('box') + '</div><div><div class="brand-name">LabFlow</div><div class="brand-caption">LABORATORY INVENTORY</div></div></div><div class="login-pitch"><div class="eyebrow">每一份耗材，都有迹可循</div><h1>让实验室耗材管理<br>井井有条。</h1><p>从入库到领用，从库存到预警。<br>查库存、登记领用、核对记录，常用操作都放在一个工作台里。</p><div class="login-illustration" aria-hidden="true"><svg viewBox="0 0 420 220" fill="none"><rect x="35" y="32" width="340" height="168" rx="16" fill="#172b48" stroke="#304766"/><rect x="55" y="53" width="300" height="28" rx="6" fill="#243d60"/><circle cx="69" cy="67" r="4" fill="#7ca4ed"/><path d="M83 67h74" stroke="#7894bb" stroke-width="4" stroke-linecap="round"/><rect x="56" y="99" width="87" height="78" rx="8" fill="#213b62"/><path d="m99 112 21 12-21 12-21-12 21-12ZM78 124v23l21 12 21-12v-23m-21 12v23" stroke="#83aeff" stroke-width="2"/><path d="M164 110h71M164 125h159M164 144h119M164 163h151" stroke="#456487" stroke-width="5" stroke-linecap="round"/><rect x="292" y="12" width="99" height="50" rx="11" fill="#2864e8"/><path d="m309 37 6 6 12-14" stroke="white" stroke-width="3" stroke-linecap="round"/><path d="M337 31h36M337 42h25" stroke="#b8cfff" stroke-width="3" stroke-linecap="round"/><rect x="13" y="146" width="117" height="57" rx="11" fill="#eaf7f2"/><path d="M29 183v-13m10 13v-22m10 22v-18" stroke="#35a482" stroke-width="4" stroke-linecap="round"/><path d="M66 164h45M66 176h31M66 188h38" stroke="#8cbfad" stroke-width="3" stroke-linecap="round"/></svg></div></div><div class="login-brand-foot"><span>库存有数</span><span>领用有据</span><span>数据可核对</span></div></section><main class="login-form-panel" id="main-content"><div class="login-card">' + websiteLink('login-site-link') + '<h2>登录工作台</h2><p class="login-subtitle">' + (cloudMode ? '请输入管理员创建的正式账号；本网站不使用公共演示密码。' : '选择一个示例账号，开始体验完整流程。') + '</p><form data-form="login"><div class="field"><label for="username">用户名</label><input id="username" name="username" autocomplete="username" required maxlength="80" placeholder="请输入用户名"></div><div class="field"><label for="password">密码</label><div class="password-wrap"><input id="password" name="password" type="password" autocomplete="current-password" required placeholder="请输入密码"><button type="button" data-action="toggle-password" aria-label="显示密码">' + icon('eye') + '</button></div></div><div class="form-error" role="alert">' + esc(message || '') + '</div><button type="submit" class="btn primary wide">登录</button></form>' + (cloudMode ? '' : '<section class="demo-accounts"><div class="demo-accounts-title">快速填入示例账号<span>仅用于课程演示</span></div><div class="account-buttons"><button type="button" class="account-fill" data-account="admin"><strong>管理员</strong>完整业务操作</button><button type="button" class="account-fill" data-account="member_a"><strong>成员 A</strong>查看本人领用</button><button type="button" class="account-fill" data-account="member_b"><strong>成员 B</strong>体验数据隔离</button></div></section>') + '<div class="login-mode">' + modeDescription() + '' + (cloudMode ? '' : '<br>预置耗材与流水均为明确标记的示例数据。') + '</div><p class="login-footer">LabFlow · 实验室耗材库存与领用管理</p></div></main></div>';
  }

  function renderSetup(message) {
    document.body.classList.remove('sidebar-open');
    root.innerHTML = '<main class="login-form-panel" id="main-content" style="min-height:100vh;display:grid;place-items:center;padding:30px"><section class="login-card" style="max-width:520px;width:100%">' + websiteLink('login-site-link') + '<div class="eyebrow">首次初始化</div><h1>创建首位管理员</h1><p class="login-subtitle">云端数据库还没有正式账号。先在 Cloudflare Worker 的 Secrets 中添加 ADMIN_SETUP_TOKEN（至少24位），然后在这里填写同一个初始化凭证。初始化完成后只能由管理员添加其他成员。</p>' +
      (setupState && !setupState.configured ? note('还没有检测到 Cloudflare 的 ADMIN_SETUP_TOKEN。请先到 Worker Settings → Variables and Secrets 设置，再刷新页面。','warning') : '') +
      '<form data-form="setup"><div class="field"><label>管理员账号</label><input name="username" required minlength="3" maxlength="64" pattern="[a-zA-Z0-9._-]+" placeholder="例如：lab_admin"></div><div class="field"><label>管理员姓名/称呼</label><input name="display_name" required maxlength="120" placeholder="例如：实验室管理员"></div><div class="field"><label>管理员密码</label><input name="password" type="password" autocomplete="new-password" required minlength="12" maxlength="128" placeholder="至少12个字符"></div><div class="field"><label>Cloudflare 初始化凭证</label><input name="setup_token" type="password" autocomplete="off" required placeholder="填写已设置的 ADMIN_SETUP_TOKEN"></div><div class="form-error" role="alert">' + esc(message||'') + '</div><button type="submit" class="btn primary wide">创建管理员</button></form><p class="login-footer">凭证不会保存到浏览器；不要把密码或凭证发给别人。</p></section></main>';
  }

  function renderShell() {
    var u = data.user;
    var navigation = '<a href="?app=home" data-nav="home" class="nav-link' + (route === 'home' ? ' active' : '') + '">' + icon('home') + '<span>工作台总览</span></a>';
    apps.forEach(function (a) {
      if (a.cloudOnly && !cloudMode) return;
      if (a.group) navigation += '<div class="nav-label">' + a.group + '</div>';
      if (!a.admin || admin()) navigation += '<a href="?app=' + a.id + '" data-nav="' + a.id + '" class="nav-link' + (route === a.id ? ' active' : '') + '">' + icon(a.icon) + '<span>' + a.title + '</span>' + (a.id === 'alerts' && lowItems().length ? '<span class="nav-count">' + lowItems().length + '</span>' : '') + '</a>';
    });
    root.innerHTML = '<div class="app-shell"><button class="sidebar-overlay" data-action="menu-close" aria-label="关闭导航"></button><aside class="sidebar"><a class="brand" href="?app=home" data-nav="home"><div class="brand-symbol">' + icon('box') + '</div><div><div class="brand-name">LabFlow</div><div class="brand-caption">实验室耗材管理</div></div></a><nav class="nav-list" aria-label="主要导航">' + navigation + '</nav><div class="sidebar-foot"><p class="sidebar-note">一个实验室 · 一套库存<br>每一笔变化，都有记录</p><div class="mode-indicator"><span class="status-dot' + (mode === 'browser' ? ' amber' : '') + '"></span>' + (cloudMode ? '云端共享库存' : mode === 'server' ? '本机 Python 服务' : '当前浏览器演示') + '</div><div class="user-panel"><div class="avatar">' + esc((u.display_name || u.username).slice(0, 1)) + '</div><div class="user-info"><div class="user-name">' + esc(u.display_name || u.username) + '</div><div class="user-role">' + (admin() ? '管理员 · 全部操作权限' : '普通成员 · 本人记录') + '</div><button class="logout-button" data-action="logout" aria-label="退出登录" title="退出登录">' + icon('logout') + '</button></div></div></aside><div class="workspace"><header class="topbar"><div class="breadcrumb"><button class="icon-button mobile-menu" data-action="menu" aria-label="打开导航">' + icon('menu') + '</button><span class="breadcrumb-home">实验室管理</span><span class="breadcrumb-home">/</span><strong id="breadcrumb-current"></strong></div><div class="topbar-right">' + websiteLink() + '<span class="date-label">' + esc(new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' }).format(new Date())) + '</span>' + (cloudMode ? '<button class="text-button" data-action="change-password">修改密码</button>' : '<span class="sample-badge">示例数据集</span>') + '<button class="icon-button" data-action="refresh" aria-label="刷新最新数据" title="刷新最新数据">' + icon('refresh') + '</button><button class="icon-button" data-action="help" aria-label="使用帮助" title="使用帮助">' + icon('help') + '</button></div></header><main class="main-content" id="main-content" tabindex="-1"></main></div></div>';
    renderPage();
  }

  function renderPage() {
    var target = document.getElementById('main-content'); if (!data || !target) return;
    var app = currentApp(); var title = app ? app.title : '工作台总览';
    document.title = title + ' · LabFlow';
    document.getElementById('breadcrumb-current').textContent = title;
    root.querySelectorAll('.nav-link').forEach(function (x) { var active = x.dataset.nav === route; x.classList.toggle('active', active); if (active) x.setAttribute('aria-current', 'page'); else x.removeAttribute('aria-current'); });
    var content;
    if (app && app.cloudOnly && !cloudMode) content = heading(title, '该功能只支持云端共享模式。');
    else if (app && app.admin && !admin()) content = heading(title, '此操作由实验室管理员执行。') + '<section class="panel">' + empty('当前账号没有操作权限', '你可以查询库存、查看本人领用记录和预警；如需登记或核对，请联系管理员。', 'lock', navButton('返回工作台', 'home', 'home', 'primary')) + '</section>';
    else content = ({ home: renderHome, items: renderItems, inbound: function () { return renderMovementForm('IN'); }, outbound: function () { return renderMovementForm('OUT'); }, inventory: renderInventory, movements: renderMovements, alerts: renderAlerts, reconciliation: renderReconciliation, statistics: renderStatistics, users: renderUsers }[route])();
    target.innerHTML = content + '<footer class="page-footer"><span>LabFlow · 实验室耗材库存与领用管理 · 所有日期按 Asia/Shanghai 展示</span><div><button data-action="help">使用说明</button>' + (admin() && !cloudMode ? '　·　<button data-action="reset">重置示例数据</button>' : '') + '</div></footer>';
    if (route === 'inbound' || route === 'outbound') updateStockPreview(route === 'inbound' ? 'IN' : 'OUT');
  }

  function renderHome() {
    var active = data.items.filter(function (x) { return x.active; }); var lows = lowItems();
    var healthy = active.length - lows.length; var percent = active.length ? Math.round(healthy / active.length * 100) : 0;
    var movements = sortedMovements(); var current = movements.filter(function (x) { return dateKey(x.created_at) === today(); });
    var name = esc(data.user.display_name || data.user.username);
    var heroArt = '<div class="hero-art" aria-hidden="true"><svg viewBox="0 0 180 140" fill="none"><path d="m25 64 60-32 66 33-63 34-63-35Z" fill="#d9e6ff"/><path d="m25 64 63 35v31l-63-35V64Z" fill="#bed2fb"/><path d="m88 99 63-34v31l-63 34V99Z" fill="#91b3f4"/><path d="m49 50 62 34v31" stroke="white" stroke-width="5" opacity=".7"/><path d="m65 30 25-14 27 15-26 14-26-15Z" fill="#4a81ec"/><path d="m65 30 26 15v23L65 53V30Z" fill="#2864e8"/><path d="m91 45 26-14v23L91 68V45Z" fill="#174fc8"/><circle cx="143" cy="28" r="18" fill="white"/><path d="m135 28 5 5 10-11" stroke="#39a780" stroke-width="3" stroke-linecap="round"/></svg><span class="hero-tag">' + icon('check') + '库存变化全程留痕</span></div>';
    var hero = '<section class="hero"><div><div class="eyebrow">LABORATORY WORKSPACE</div><h1>' + name + '，工作从这里开始。</h1><p>查看库存、处理领用，把实验室的每一份耗材管理好。</p><div class="actions">' + (admin() ? navButton('登记领用', 'outbound', 'out', 'primary') + navButton('登记入库', 'inbound', 'plus') : navButton('查询耗材库存', 'inventory', 'search', 'primary') + navButton('我的领用记录', 'movements', 'list')) + '</div></div>' + heroArt + '</section>';
    var visibleApps = apps.filter(function (a) { return !a.cloudOnly || cloudMode; });
    var cards = visibleApps.map(function (a, i) { var locked = a.admin && !admin(); return '<' + (locked ? 'div' : 'a href="?app=' + a.id + '" data-nav="' + a.id + '"') + ' class="launcher-card' + (locked ? ' locked' : '') + '"><span class="launcher-num">0' + (i + 1) + '</span><span class="launcher-icon">' + icon(a.icon) + '</span><h3>' + a.title + (locked ? '<span class="small-lock">管理员</span>' : '') + '</h3><p>' + a.desc + '</p>' + (!locked ? '' : '') + '</' + (locked ? 'div' : 'a') + '>'; }).join('');
    var recent = movements.length ? table([['耗材'], ['类型'], ['数量', 'num'], ['时间']], movements.slice(0, 5).map(function (m) { var x = itemById(m.item_id) || { name: '未找到档案', code: '', unit: '' }; return '<tr><td>' + itemCell(x) + '</td><td>' + badge(m.type === 'IN' ? '入库' : '领用', m.type === 'IN' ? 'green' : 'blue') + '</td><td class="num"><span class="quantity ' + (m.type === 'IN' ? 'in' : 'out') + '">' + (m.type === 'IN' ? '+' : '−') + number(m.quantity) + '<small>' + esc(x.unit) + '</small></span></td><td><span class="small muted">' + esc(dateTime(m.created_at)) + '</span></td></tr>'; }), 'compact') : empty('还没有业务记录', admin() ? '从登记第一笔耗材入库开始。' : '管理员登记你的领用后，记录会显示在这里。', 'list');
    return hero + '<div class="kpi-grid">' + kpi('启用耗材', active.length, '种', 'box', '', '共 ' + data.items.length + ' 个耗材档案') + kpi('待关注库存', lows.length, '种', 'bell', 'amber', lows.length ? '当前数量已达到或低于下限' : '启用耗材均高于预警下限') + kpi(admin() ? '今日业务记录' : '今日本人领用', current.length, '笔', 'clock', 'green', '统计上海时间今天的记录') + kpi(admin() ? '累计业务流水' : '本人领用记录', movements.length, '笔', 'list', 'slate', admin() ? '全部历史入库与领用记录' : '仅包含当前账号可见记录') + '</div><div class="section-head"><h2>功能工具</h2><p>' + visibleApps.length + ' 个工具 · 同一套业务数据</p></div><div class="launcher-grid">' + cards + '</div><div class="section-head"><h2>实验室动态</h2><p>刷新后获取最新库存状态</p></div><div class="grid-wide"><section class="panel"><div class="panel-head"><div><h2 class="panel-title">' + (admin() ? '近期出入库记录' : '近期本人领用') + '</h2><p>最近 5 笔已登记记录</p></div><a class="text-button" href="?app=movements" data-nav="movements">查看全部</a></div>' + recent + '</section><section class="panel"><div class="panel-head"><h2 class="panel-title">库存健康概览</h2></div><div class="panel-body"><div class="health-top"><div class="health-ring" style="--ring:conic-gradient(#5286ed 0% ' + percent + '%,#edf1f7 ' + percent + '% 100%)"><strong>' + percent + '<small>%</small></strong></div><div class="health-copy"><h3>启用耗材正常占比</h3><p>仅表示库存高于下限的品种占比，不代表预测结果。</p></div></div><div class="health-row"><span><i class="dot green"></i>库存正常</span><strong>' + healthy + ' 种</strong></div><div class="health-row"><span><i class="dot amber"></i>达到或低于下限</span><strong>' + lows.length + ' 种</strong></div><div class="health-row"><span><i class="dot slate"></i>已停用档案</span><strong>' + (data.items.length - active.length) + ' 种</strong></div><div class="health-foot">' + (lows.length ? '有 ' + lows.length + ' 种耗材需要关注，可前往预警页面查看。' : '当前没有低库存预警，继续保持日常登记。') + '</div></div></section></div><p class="demo-strip">' + icon('info') + '<span>' + modeDescription() + '</span></p>';
  }

  function filteredItems(key) {
    var f = filters[key];
    return data.items.filter(function (x) {
      if (!matching([x.code, x.name, x.spec, x.location].join(' '), f.q)) return false;
      if (key === 'items') return f.active === 'all' || (f.active === 'active' ? x.active : !x.active);
      if (f.status === 'normal') return x.active && x.current_stock > x.min_stock;
      if (f.status === 'low') return x.active && x.current_stock <= x.min_stock;
      if (f.status === 'zero') return x.active && x.current_stock === 0;
      if (f.status === 'inactive') return !x.active;
      return true;
    }).sort(function (a, b) { return a.code.localeCompare(b.code, 'zh-CN'); });
  }

  function renderItems() {
    var f = filters.items;
    return heading('耗材档案', '定义耗材的固定计量单位与存放信息，新增档案的初始库存为 0。', button('导出 CSV', 'export', 'download', '', 'data-kind="items"') + (admin() ? button('新增耗材', 'create-item', 'plus', 'primary') : '')) + (!admin() ? note('当前为成员账号，可查看档案；新增、编辑和停用由管理员执行。', 'neutral') : '') + '<section class="panel"><form class="filter-bar" data-form="filter" data-key="items">' + searchField(f.q, '搜索名称、编码、规格或存放位置') + selectField('active', '启用状态', [['all', '全部状态'], ['active', '已启用'], ['inactive', '已停用']], f.active, true) + filterEnd('items') + paginated(filteredItems('items'), function (x) { return '<tr><td>' + itemCell(x) + '</td><td>' + esc(x.unit) + '</td><td>' + esc(x.location || '未设置') + '</td><td class="num">' + number(x.current_stock) + '</td><td class="num">' + number(x.min_stock) + '</td><td>' + badge(x.active ? '已启用' : '已停用', x.active ? 'green' : '') + '</td>' + (admin() ? '<td><button class="text-button" data-action="edit-item" data-id="' + esc(x.id) + '">编辑</button><button class="text-button ' + (x.active ? 'muted' : '') + '" data-action="toggle-item" data-id="' + esc(x.id) + '">' + (x.active ? '停用' : '启用') + '</button></td>' : '') + '</tr>'; }, [['耗材 / 编码'], ['固定单位'], ['存放位置'], ['当前数量', 'num'], ['预警下限', 'num'], ['状态']].concat(admin() ? [['操作']] : []), 'items', '还没有符合条件的耗材', admin() ? '新增耗材档案，或调整筛选条件后再试。' : '请调整筛选条件，或联系管理员新增耗材。') + '</section>' + '<p class="demo-strip">' + icon('info') + '<span>编码和单位创建后固定；停用后保留全部历史，不允许新入库或领用，也不参与预警。</span></p>';
  }

  function renderInventory() {
    var f = filters.inventory;
    return heading('库存查询', '按名称、编码或位置查找耗材，所有数量均使用档案中的固定单位。', button('导出 CSV', 'export', 'download', '', 'data-kind="inventory"')) + '<section class="panel"><form class="filter-bar" data-form="filter" data-key="inventory">' + searchField(f.q, '例如：手套、HC001、A 区') + selectField('status', '库存状态', [['all', '全部状态'], ['normal', '库存正常'], ['low', '达到或低于下限'], ['zero', '库存为 0'], ['inactive', '已停用']], f.status, true) + filterEnd('inventory') + paginated(filteredItems('inventory'), function (x) { return '<tr><td>' + itemCell(x) + '</td><td>' + esc(x.location || '未设置') + '</td><td class="num"><span class="quantity">' + number(x.current_stock) + '<small>' + esc(x.unit) + '</small></span></td><td class="num">' + number(x.min_stock) + ' <span class="muted">' + esc(x.unit) + '</span></td><td>' + stockBadge(x) + '</td><td>' + (admin() && x.active ? '<button class="text-button" data-action="quick-movement" data-id="' + esc(x.id) + '" data-type="IN">入库</button><button class="text-button" data-action="quick-movement" data-id="' + esc(x.id) + '" data-type="OUT">领用</button>' : '<button class="text-button" data-action="item-movements" data-id="' + esc(x.id) + '">' + (admin() ? '查看流水' : '本人记录') + '</button>') + '</td></tr>'; }, [['耗材 / 规格'], ['存放位置'], ['当前库存', 'num'], ['预警下限', 'num'], ['状态'], ['操作']], 'inventory') + '</section><p class="demo-strip">' + icon('info') + '<span>库存不能直接改写，数量变化必须通过入库或领用登记完成。不同计量单位不混合求和。</span></p>';
  }

  function renderMovementForm(type) {
    var incoming = type === 'IN'; var draft = drafts[type]; var active = data.items.filter(function (x) { return x.active; });
    var recipientOptions = data.users.filter(function (u) { return u.role === 'member' && u.active !== false; });
    var disabled = draft.posted ? ' disabled' : '';
    var itemOptions = active.slice(); var selectedItem = itemById(draft.item_id);
    if (draft.posted && selectedItem && !selectedItem.active) itemOptions.push(selectedItem);
    var receipt = draft.posted ? '<div class="receipt" role="status"><h3>' + icon('check') + (draft.posted.idempotent ? '已返回原记录，未重复记账' : (incoming ? '入库已登记' : '领用已登记')) + '</h3><p>本次返回时库存：<strong>' + number(draft.posted.current_stock) + ' ' + esc(selectedItem ? selectedItem.unit : '') + '</strong>。这笔单据已锁定，点击“新建下一笔”继续登记。</p><p class="mono">业务单号：' + esc(draft.business_no) + '</p></div>' : '';
    var preview = '<section class="panel"><div class="panel-head"><h2 class="panel-title">库存与登记提示</h2></div><div class="panel-body"><div id="stock-preview" class="stock-preview"></div><ul class="rule-list"><li>' + icon('check') + '<span>数量必须为正整数，最多 1,000,000,000；按固定单位登记。</span></li><li>' + icon('shield') + '<span>' + (incoming ? '库存和入库记录一起保存；任一失败时，两者均不变化。' : '领用不得超过现有库存，且必须选择有效的领用成员。') + '</span></li><li>' + icon('list') + '<span>同一业务单号、同一内容再次提交，不会重复增加或扣减库存。</span></li><li>' + icon('lock') + '<span>已登记流水保留原始记录，不能直接修改或删除。</span></li></ul></div></section>';
    return heading(incoming ? '入库登记' : '领用登记', incoming ? '记录耗材到货，成功保存后库存同步增加。' : '选择耗材与领用人，成功保存后库存同步扣减。', navButton('查看历史流水', 'movements', 'list')) + (active.length || draft.posted ? '' : note('没有可登记的启用耗材，请先在耗材档案中新增或启用一个档案。', 'warning')) + '<div class="grid-wide"><section class="panel"><div class="panel-head"><div><h2 class="panel-title">' + (incoming ? '新建入库记录' : '新建领用记录') + '</h2><p>带 * 的字段为必填项</p></div>' + badge('管理员登记', 'blue') + '</div><div class="panel-body">' + receipt + '<form data-form="movement" data-type="' + type + '"><div class="form-grid"><div class="field full"><label for="movement-item">耗材<span class="required">*</span></label><select id="movement-item" name="item_id" required' + disabled + '>' + option('', '请选择一个启用耗材', draft.item_id) + itemOptions.map(function (x) { return option(x.id, x.code + ' · ' + x.name + '（当前 ' + x.current_stock + ' ' + x.unit + '）', draft.item_id); }).join('') + '</select></div><div class="field"><label for="movement-quantity">' + (incoming ? '入库' : '领用') + '数量<span class="required">*</span></label><input id="movement-quantity" name="quantity" type="number" min="1" max="1000000000" step="1" inputmode="numeric" placeholder="输入正整数" value="' + esc(draft.quantity) + '" required' + disabled + '><span class="field-help" id="quantity-unit">按所选耗材的固定单位登记</span></div>' + (!incoming ? '<div class="field"><label for="movement-recipient">领用人<span class="required">*</span></label><select id="movement-recipient" name="recipient_id" required' + disabled + '>' + option('', '请选择领用成员', draft.recipient_id) + recipientOptions.map(function (u) { return option(u.id, (u.display_name || u.username) + ' · ' + u.username, draft.recipient_id); }).join('') + '</select></div>' : '<div class="field"><label>经办人</label><input value="' + esc(data.user.display_name || data.user.username) + '" disabled><span class="field-help">由当前登录账号自动记录</span></div>') + '<div class="field full"><label for="movement-business">业务单号</label><input id="movement-business" class="mono" name="business_no" value="' + esc(draft.business_no) + '" readonly><span class="field-help">系统生成；重试时保留同一单号，防止重复记账。</span></div><div class="field full"><label for="movement-note">' + (incoming ? '入库说明' : '领用用途') + '<span class="muted"> · 选填</span></label><textarea id="movement-note" name="note" maxlength="500" rows="3" placeholder="例如：' + (incoming ? '本周耗材补充' : '课程实验使用') + '"' + disabled + '>' + esc(draft.note) + '</textarea><span class="field-help">最多 500 字，请勿填写手机号等无关个人信息。</span></div></div><div class="form-error" role="alert"></div><div class="form-actions"><button type="submit" class="btn primary"' + (!active.length && !draft.posted ? ' disabled' : '') + '>' + icon(draft.posted ? 'refresh' : (incoming ? 'in' : 'out')) + (draft.posted ? '再次确认同一业务单' : (incoming ? '确认入库' : '确认领用')) + '</button>' + button('新建下一笔', 'new-movement', 'plus', '', 'data-type="' + type + '"') + '</div></form></div></section><div class="stack">' + preview + '<div class="mode-banner">' + modeDescription() + '</div></div></div>';
  }

  function updateStockPreview(type) {
    var el = document.getElementById('stock-preview'); if (!el) return;
    var draft = drafts[type]; var item = itemById(draft.item_id); var unit = document.getElementById('quantity-unit');
    if (!item) { el.innerHTML = '<h3>先选择一个耗材</h3><p>这里将显示当前库存、位置与预警下限。</p><div class="stock-preview-number">—</div>'; if (unit) unit.textContent = '按所选耗材的固定单位登记'; return; }
    if (unit) unit.textContent = '固定单位：' + item.unit + (type === 'OUT' ? '；当前最多可领用 ' + item.current_stock + ' ' + item.unit : '');
    var q = Number(draft.quantity); var projected = type === 'IN' ? item.current_stock + q : item.current_stock - q;
    var hint = !draft.posted && draft.quantity && Number.isInteger(q) && q > 0 ? '<p style="margin-top:12px">预计登记后：<strong>' + (projected < 0 ? '库存不足，无法提交' : projected > 1000000000 ? '超过库存数量上限' : number(projected) + ' ' + esc(item.unit)) + '</strong></p>' : '';
    el.innerHTML = '<h3>' + esc(item.name) + '</h3><p>' + esc(item.code) + ' · ' + esc(item.location || '未设置位置') + '</p><div class="stock-preview-number">' + number(item.current_stock) + '<span>' + esc(item.unit) + '</span></div><div class="stock-preview-bottom"><span>预警下限 ' + number(item.min_stock) + ' ' + esc(item.unit) + '</span>' + stockBadge(item) + '</div>' + hint;
  }

  function filteredMovements(key) {
    var f = filters[key];
    return sortedMovements().filter(function (m) {
      var item = itemById(m.item_id) || {}; var day = dateKey(m.created_at);
      return (!f.q || matching([m.business_no, item.code, item.name, m.note].join(' '), f.q)) && (!f.type || f.type === m.type) && (!f.item_id || f.item_id === m.item_id) && (!f.recipient_id || f.recipient_id === m.recipient_id) && (!f.start || day >= f.start) && (!f.end || day <= f.end);
    });
  }

  function renderMovements() {
    var f = filters.movements;
    return heading(admin() ? '出入库流水' : '我的领用记录', admin() ? '所有登记保留原始记录；日期筛选只影响浏览，不改变库存核对的历史范围。' : '这里只显示当前账号的本人领用记录，无法查看其他成员的记录。', button('导出 CSV', 'export', 'download', '', 'data-kind="movements"')) + '<section class="panel"><form class="filter-bar" data-form="filter" data-key="movements">' + searchField(f.q, '搜索业务单号、耗材或备注') + (admin() ? selectField('type', '业务类型', [['', '全部类型'], ['IN', '入库'], ['OUT', '领用']], f.type, true) : '') + selectField('item_id', '耗材', [['', '全部耗材']].concat(data.items.map(function (x) { return [x.id, x.name]; })), f.item_id, true) + dateFields(f) + (admin() ? selectField('recipient_id', '领用人', [['', '全部领用人']].concat(data.users.filter(function (u) { return u.role === 'member' && u.active !== false; }).map(function (u) { return [u.id, u.display_name || u.username]; })), f.recipient_id, true) : '') + filterEnd('movements') + paginated(filteredMovements('movements'), function (m) { var x = itemById(m.item_id) || { name: '未找到档案', code: '', unit: '' }; return '<tr><td><div class="cell-main">' + esc(dateTime(m.created_at)) + '</div><div class="cell-sub mono">' + esc(m.business_no) + '</div></td><td>' + itemCell(x) + '</td><td>' + badge(m.type === 'IN' ? '入库' : '领用', m.type === 'IN' ? 'green' : 'blue') + '</td><td class="num"><span class="quantity ' + (m.type === 'IN' ? 'in' : 'out') + '">' + (m.type === 'IN' ? '+' : '−') + number(m.quantity) + '<small>' + esc(x.unit) + '</small></span></td><td>' + esc(userName(m.recipient_id)) + '</td>' + (admin() ? '<td>' + esc(userName(m.operator_id)) + '</td>' : '') + '<td class="cell-note">' + esc(m.note || '—') + '</td></tr>'; }, [['时间 / 业务单号'], ['耗材'], ['类型'], ['数量', 'num'], ['领用人']].concat(admin() ? [['经办人']] : []).concat([['说明 / 用途']]), 'movements', '没有符合条件的流水', '调整日期或耗材筛选；已成功登记的业务才会出现在这里。') + '</section>';
  }

  function filteredAlerts() { var f = filters.alerts; return lowItems().filter(function (x) { return matching([x.name, x.code, x.location].join(' '), f.q) && (f.status === 'all' || (f.status === 'zero' ? x.current_stock === 0 : x.current_stock === x.min_stock)); }).sort(function (a, b) { return a.current_stock - b.current_stock || a.code.localeCompare(b.code); }); }
  function renderAlerts() {
    var all = lowItems(); var f = filters.alerts;
    return heading('低库存预警', '主动关注库存临界值，为下一次实验提前做好准备。', button('导出 CSV', 'export', 'download', '', 'data-kind="alerts"') + (admin() ? button('设置预警下限', 'threshold', 'edit', 'primary') : '')) + note('<strong>提醒规则：启用耗材的当前库存 ≤ 预警下限。</strong> 库存等于下限时也会提醒；下限为 0 时，零库存仍会提醒。停用耗材不进入此列表。') + '<div class="metric-row"><div><strong>' + all.length + '</strong><span>待关注耗材</span></div><div><strong>' + all.filter(function (x) { return x.current_stock === 0; }).length + '</strong><span>库存已耗尽</span></div><div><strong>' + all.filter(function (x) { return x.current_stock === x.min_stock; }).length + '</strong><span>恰好达到下限（含零库存）</span></div></div><section class="panel"><form class="filter-bar" data-form="filter" data-key="alerts">' + searchField(f.q, '搜索耗材名称、编码或位置') + selectField('status', '提醒类型', [['all', '全部提醒'], ['zero', '库存已耗尽'], ['equal', '恰好达到下限']], f.status, true) + filterEnd('alerts') + paginated(filteredAlerts(), function (x) { return '<tr><td>' + itemCell(x) + '</td><td>' + esc(x.location || '未设置') + '</td><td class="num"><span class="quantity">' + number(x.current_stock) + '<small>' + esc(x.unit) + '</small></span></td><td class="num">' + number(x.min_stock) + '</td><td class="num">' + number(x.min_stock - x.current_stock) + '</td><td>' + stockBadge(x) + '</td>' + (admin() ? '<td><button class="text-button" data-action="threshold" data-id="' + esc(x.id) + '">设下限</button><button class="text-button" data-action="quick-movement" data-id="' + esc(x.id) + '" data-type="IN">补充入库</button></td>' : '') + '</tr>'; }, [['耗材 / 编码'], ['存放位置'], ['当前数量', 'num'], ['预警下限', 'num'], ['距下限差额', 'num'], ['提醒']].concat(admin() ? [['操作']] : []), 'alerts', all.length ? '没有符合筛选条件的预警' : '当前没有低库存预警', all.length ? '调整关键词或提醒类型后再试。' : '启用耗材的库存均高于下限。', 'bell') + '</section><p class="demo-strip">' + icon('info') + '<span>“距下限差额”为下限减当前库存，仅供参考，不自动生成采购单；等于下限时差额为 0，仍会提醒。</span></p>';
  }

  function renderReconciliation() {
    var result = reconciliation; var inconsistent = result ? result.rows.filter(function (x) { return x.difference !== 0; }).length : 0;
    return heading('库存核对', '使用全部历史入库减去全部历史领用，与当前库存逐项比较。', button(result ? '重新核对' : '核对全部历史', 'reconcile', 'shield', 'primary') + (result ? button('导出结果', 'export', 'download', '', 'data-kind="reconciliation"') : '')) + note('<strong>核对范围始终是全部历史流水，包括停用耗材。</strong> 流水页面的日期筛选不影响这里；发现差异只提示调查，不自动改写库存或流水。') + (result ? '<div class="kpi-grid" style="margin-bottom:20px">' + kpi('已核对耗材', result.rows.length, '种', 'box', '', '包含启用和停用档案') + kpi('核对一致', result.rows.length - inconsistent, '种', 'check', 'green', '当前库存 = 全历史流水净额') + kpi('需要核查', inconsistent, '种', 'bell', inconsistent ? 'amber' : 'slate', '差额 = 当前库存 − 流水净额') + kpi('已停用耗材', result.rows.filter(function (x) { return !x.active; }).length, '种', 'box', 'slate', '核对时间 ' + esc(dateTime(result.checked_at))) + '</div><section class="panel"><div class="panel-head"><div><h2 class="panel-title">核对结果</h2><p>快照时间：' + esc(dateTime(result.checked_at)) + ' · 如有新登记，请重新核对</p></div>' + badge(inconsistent ? '存在差异，请核查' : '全部一致', inconsistent ? 'red' : 'green') + '</div>' + paginated(result.rows, function (x) { return '<tr><td><div class="cell-main">' + esc(x.name) + '</div><div class="cell-sub">' + esc(x.code) + (x.active ? '' : ' · 已停用') + '</div></td><td class="num">' + number(x.inbound) + '</td><td class="num">' + number(x.outbound) + '</td><td class="num">' + number(x.ledger_stock) + '</td><td class="num">' + number(x.current_stock) + '</td><td class="num"><strong' + (x.difference ? ' style="color:var(--red)"' : '') + '>' + number(x.difference) + '</strong></td><td>' + badge(x.difference === 0 ? '一致' : '需核查', x.difference === 0 ? 'green' : 'red') + '</td></tr>'; }, [['耗材'], ['全部入库', 'num'], ['全部领用', 'num'], ['流水净额', 'num'], ['当前库存', 'num'], ['差额', 'num'], ['结果']], 'reconciliation') + '</section>' : '<section class="panel">' + empty('准备核对全部历史记录', '核对会读取一致的数据快照，不改变任何库存与流水。点击上方按钮开始。', 'shield', button('开始库存核对', 'reconcile', 'shield', 'primary')) + '</section>');
  }

  function statisticsData() {
    var records = filteredMovements('statistics'); var units = Object.create(null); var ranks = Object.create(null); var days = Object.create(null);
    records.forEach(function (m) {
      var item = itemById(m.item_id) || { name: '未找到档案', unit: '未设置单位' }; var unit = item.unit;
      if (!units[unit]) units[unit] = { unit: unit, inbound: 0, outbound: 0 };
      units[unit][m.type === 'IN' ? 'inbound' : 'outbound'] += m.quantity;
      var day = dateKey(m.created_at); if (!days[day]) days[day] = { date: day, IN: 0, OUT: 0 }; days[day][m.type] += 1;
      if (m.type === 'OUT') { if (!ranks[m.item_id]) ranks[m.item_id] = { item: item, count: 0, quantity: 0 }; ranks[m.item_id].count += 1; ranks[m.item_id].quantity += m.quantity; }
    });
    return { records: records, units: Object.keys(units).sort().map(function (k) { return units[k]; }), ranks: Object.keys(ranks).map(function (k) { return ranks[k]; }).sort(function (a, b) { return b.count - a.count; }), days: Object.keys(days).sort().slice(-7).map(function (k) { return days[k]; }) };
  }

  function renderStatistics() {
    var f = filters.statistics; var s = statisticsData(); var ins = s.records.filter(function (m) { return m.type === 'IN'; }); var outs = s.records.filter(function (m) { return m.type === 'OUT'; });
    var maxBar = Math.max.apply(null, [1].concat(s.days.map(function (d) { return Math.max(d.IN, d.OUT); })));
    var trend = s.days.length ? '<div class="bar-chart" role="img" aria-label="所选范围最近七个有记录日期的入库与领用笔数">' + s.days.map(function (d) { return '<div class="bar-group">' + (admin() ? '<div class="chart-bar" style="height:' + Math.max(2, d.IN / maxBar * 87) + '%" title="' + esc(d.date) + ' 入库 ' + d.IN + ' 笔"><b>' + d.IN + '</b></div>' : '') + '<div class="chart-bar out" style="height:' + Math.max(2, d.OUT / maxBar * 87) + '%" title="' + esc(d.date) + ' 领用 ' + d.OUT + ' 笔"><b>' + d.OUT + '</b></div><span class="bar-label">' + esc(d.date.slice(5)) + '</span></div>'; }).join('') + '</div><p class="chart-caption">显示所选范围内最近 7 个有记录的业务日期，柱高表示笔数。</p>' : empty('暂无可统计记录', '调整日期范围，或先完成业务登记。', 'chart');
    var rankMax = s.ranks.length ? s.ranks[0].count : 1;
    var ranking = s.ranks.length ? '<div class="rank-list">' + s.ranks.slice(0, 5).map(function (r, i) { return '<div class="rank-item"><span class="rank-num">0' + (i + 1) + '</span><div class="rank-body"><div class="rank-top"><span>' + esc(r.item.name) + '</span><strong>' + number(r.count) + ' 笔</strong></div><div class="rank-track"><div class="rank-fill" style="width:' + (r.count / rankMax * 100) + '%"></div></div><p class="rank-sub">累计领用 ' + number(r.quantity) + ' ' + esc(r.item.unit) + '</p></div></div>'; }).join('') + '</div>' : empty('暂无领用记录', '成功登记领用后，将显示常用耗材。', 'out');
    return heading(admin() ? '数据统计' : '我的领用统计', admin() ? '由已保存的业务记录计算，按计量单位分别汇总数量。' : '以下统计只使用当前账号可见的本人领用记录。', button('导出汇总', 'export', 'download', '', 'data-kind="statistics"')) + '<section class="panel" style="margin-bottom:20px"><form class="filter-bar" data-form="filter" data-key="statistics" style="border-bottom:0">' + dateFields(f) + '<div class="filter-field"><span class="field-help">' + (f.start || f.end ? '当前为所选日期范围' : '当前统计全部历史记录') + '<br>日期包含开始日与结束日。</span></div>' + filterEnd('statistics') + '</section><div class="kpi-grid" style="margin-bottom:20px">' + kpi('业务记录', s.records.length, '笔', 'list', '', '当前筛选范围内的可见流水') + kpi(admin() ? '入库记录' : '领用数量单位', admin() ? ins.length : s.units.length, admin() ? '笔' : '类', admin() ? 'in' : 'layers', 'green', admin() ? '已登记的耗材入库' : '不同计量单位分别汇总') + kpi('领用记录', outs.length, '笔', 'out', 'amber', admin() ? '全部成员的领用记录' : '仅限当前成员本人') + kpi('涉及耗材', new Set(s.records.map(function (m) { return m.item_id; })).size, '种', 'box', 'slate', '按耗材档案去重计算') + '</div><div class="grid-2"><section class="panel"><div class="panel-head"><div><h2 class="panel-title">业务记录分布</h2><p>按上海时间的业务日期归组</p></div><div class="chart-legend">' + (admin() ? '<span><i class="dot"></i>入库</span>' : '') + '<span><i class="dot green"></i>领用</span></div></div><div class="panel-body">' + trend + '</div></section><section class="panel"><div class="panel-head"><div><h2 class="panel-title">常用耗材</h2><p>按领用记录笔数排序 · 前 5 项</p></div></div><div class="panel-body">' + ranking + '</div></section></div><section class="panel" style="margin-top:20px"><div class="panel-head"><div><h2 class="panel-title">按计量单位汇总</h2><p>同一单位内累加，不将“个”“盒”“瓶”等不同单位混为总数量。</p></div></div>' + (s.units.length ? table([['计量单位']].concat(admin() ? [['入库数量', 'num']] : []).concat([['领用数量', 'num']]), s.units.map(function (u) { return '<tr><td><div class="cell-main">' + esc(u.unit) + '</div></td>' + (admin() ? '<td class="num">' + number(u.inbound) + '</td>' : '') + '<td class="num">' + number(u.outbound) + '</td></tr>'; }), 'small-table') : empty('当前范围暂无数量汇总', '试试扩大日期范围。', 'chart')) + '</section>';
  }

  function showModal(title, body) {
    modalFocus = document.activeElement;
    modalRoot.innerHTML = '<div class="modal-backdrop" data-backdrop="true"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div class="modal-head"><h2 id="modal-title">' + title + '</h2><button class="icon-button" data-action="close-modal" aria-label="关闭弹窗">' + icon('close') + '</button></div><div class="modal-body">' + body + '</div></section></div>';
    document.body.classList.add('modal-open');
    var field = modalRoot.querySelector('input:not([readonly]),select,button'); if (field) field.focus();
  }
  function closeModal() { if (busy) return; modalRoot.innerHTML = ''; document.body.classList.remove('modal-open'); if (modalFocus && modalFocus.isConnected) modalFocus.focus(); }
  function itemModal(id) {
    if (!admin()) return; var x = id ? itemById(id) : { code: '', name: '', unit: '', spec: '', location: '', min_stock: 0, active: true }; if (!x) return;
    function field(name, label, value, max, required, readOnly, help) { return '<div class="field"><label for="item-' + name + '">' + label + (required ? '<span class="required">*</span>' : '') + '</label><input id="item-' + name + '" name="' + name + '" value="' + esc(value) + '" maxlength="' + max + '"' + (required ? ' required' : '') + (readOnly ? ' readonly' : '') + '>' + (help ? '<span class="field-help">' + help + '</span>' : '') + '</div>'; }
    showModal(id ? '编辑耗材档案' : '新增耗材档案', '<p class="modal-description">' + (id ? '编码与固定单位不变，数量请通过入库或领用登记调整。' : '新增档案初始库存为 0，建档后再登记入库。') + '</p><form data-form="item" data-id="' + esc(id || '') + '"><div class="form-grid">' + field('code', '耗材编码', x.code, 64, true, Boolean(id), '唯一编码，创建后固定') + field('name', '耗材名称', x.name, 120, true) + field('unit', '固定计量单位', x.unit, 30, true, Boolean(id), '例如：个、瓶、盒；只记整数') + field('spec', '规格', x.spec, 200) + field('location', '存放位置', x.location, 200) + '<div class="field"><label for="item-min">预警下限<span class="required">*</span></label><input id="item-min" name="min_stock" type="number" min="0" max="1000000000" step="1" value="' + esc(x.min_stock) + '" required></div>' + (id ? '<div class="field full"><label for="item-active">档案状态</label><select id="item-active" name="active">' + option('true', '启用，可登记出入库', x.active ? 'true' : 'false') + option('false', '停用，保留历史且停止预警', x.active ? 'true' : 'false') + '</select></div>' : '') + '</div><div class="form-error" role="alert"></div><div class="form-actions"><button type="submit" class="btn primary">' + icon('check') + '保存档案</button>' + button('取消', 'close-modal', '', 'ghost') + '</div></form>');
  }
  function thresholdModal(id) {
    if (!admin()) return; var items = data.items; if (!items.length) { toast('请先新增一个耗材档案。', true); return; }
    var x = itemById(id) || lowItems()[0] || items[0];
    showModal('设置预警下限', '<p class="modal-description">当前库存等于或低于下限就会提醒。下限为 0 不会关闭零库存提醒，停用档案不参与预警。</p><form data-form="threshold"><div class="form-grid"><div class="field full"><label for="threshold-item">耗材</label><select id="threshold-item" name="item_id">' + items.map(function (i) { return option(i.id, i.code + ' · ' + i.name + (i.active ? '' : '（已停用）'), x.id); }).join('') + '</select></div><div class="field full"><label for="threshold-value">预警下限<span class="required">*</span></label><input id="threshold-value" name="min_stock" type="number" min="0" max="1000000000" step="1" value="' + x.min_stock + '" required><span class="field-help" id="threshold-help">当前库存 ' + number(x.current_stock) + ' ' + esc(x.unit) + '</span></div></div><div class="form-error" role="alert"></div><div class="form-actions"><button type="submit" class="btn primary">保存下限</button>' + button('取消', 'close-modal', '', 'ghost') + '</div></form>');
  }
  function renderUsers() {
    if (!admin() || !cloudMode) return heading('成员管理','仅在云端正式账号模式下提供。');
    var members = data.users.slice().sort(function (a,b) { return a.username.localeCompare(b.username); });
    return heading('成员管理','管理员创建账号、停用/启用成员以及重设密码；停用不会删除历史领用记录。',button('添加成员','create-user','plus','primary')) +
      '<section class="panel">' + paginated(members,function(u){return '<tr><td><strong>'+esc(u.display_name)+'</strong><div class="small muted">'+esc(u.username)+'</div></td><td>'+esc(u.role==='admin'?'管理员':'普通成员')+'</td><td>'+badge(u.active!==false?'已启用':'已停用',u.active!==false?'green':'')+'</td><td>'+(u.id===data.user.id?'当前账号':button('编辑','edit-user','edit','small','data-id="'+esc(u.id)+'"')+button('重设密码','user-password','lock','small','data-id="'+esc(u.id)+'"'))+'</td></tr>';},[['成员'],['角色'],['状态'],['操作']],'users','还没有成员','请先创建普通成员，才能分配领用人。')+'</section>' +
      '<p class="demo-strip">管理员不能查看任何人的密码。重设密码后，旧会话会立即失效；成员的历史领用记录仍保留。</p>';
  }
  function userModal(id){
    if(!cloudMode||!admin())return;
    var x=id?data.users.find(function(u){return u.id===id;}):null;
    var body='<form data-form="'+(id?'edit-user':'create-user')+'"'+(id?' data-id="'+esc(id)+'"':'')+'><div class="field"><label>用户名</label><input name="username" value="'+esc(x?x.username:'')+'"'+(id?' readonly':' required pattern="[a-zA-Z0-9._-]{3,64}"')+' maxlength="64"></div><div class="field"><label>显示名称</label><input name="display_name" value="'+esc(x?x.display_name:'')+'" required maxlength="120"></div><div class="field"><label>权限角色</label><select name="role">'+option('member','普通成员',x?x.role:'member')+option('admin','管理员',x?x.role:'member')+'</select></div>'+(id?'<div class="field"><label>账号状态</label><select name="active">'+option('true','已启用',String(x.active!==false))+option('false','已停用',String(x.active!==false))+'</select></div>':'<div class="field"><label>初始密码（至少12位）</label><input name="password" type="password" minlength="12" maxlength="128" required autocomplete="new-password"></div>')+
      '<div class="form-error" role="alert"></div><div class="form-actions"><button type="submit" class="btn primary">保存</button>'+button('取消','close-modal','','ghost')+'</div></form>';
    showModal(id?'编辑成员':'创建成员',body);
  }
  function passwordModal(id){
    if(!cloudMode)return;
    var self=!id;var x=id?data.users.find(function(u){return u.id===id;}):data.user;
    if(!x)return;
    showModal(self?'修改我的密码':'重设 '+esc(x.display_name)+' 的密码','<form data-form="'+(self?'self-password':'user-password')+'"'+(id?' data-id="'+esc(id)+'"':'')+'>'+
      (self?'<div class="field"><label>当前密码</label><input name="current_password" type="password" required autocomplete="current-password"></div>':'<p class="modal-description">重设后，该成员所有设备需要重新登录。不要把新密码放到公开群聊或仓库里。</p>')+
      '<div class="field"><label>新密码（至少12位）</label><input name="new_password" type="password" minlength="12" maxlength="128" required autocomplete="new-password"></div><div class="form-error" role="alert"></div><div class="form-actions"><button type="submit" class="btn primary">确认修改</button>'+button('取消','close-modal','','ghost')+'</div></form>');
  }

  function helpModal() {
    showModal('开始使用 LabFlow', '<p class="modal-description">八个工具共享同一套耗材与业务记录，可以独立打开，也可以连续完成业务流程。</p><ul class="rule-list"><li>' + icon('box') + '<span><strong>1. 建立档案。</strong>管理员填写名称、固定单位与预警下限，新档案库存为 0。</span></li><li>' + icon('in') + '<span><strong>2. 登记入库与领用。</strong>先入库，再选择成员登记领用。数量使用固定单位的正整数。</span></li><li>' + icon('bell') + '<span><strong>3. 查询与预警。</strong>库存达到或低于下限时提醒；停用后保留历史。</span></li><li>' + icon('shield') + '<span><strong>4. 核对与统计。</strong>核对使用全部历史，统计可按日期筛选；结果来自当前保存的数据。</span></li><li>' + icon('user') + '<span><strong>成员账号。</strong>可查看耗材库存、预警和本人领用，登记与核对由管理员操作。</span></li></ul><div class="mode-banner" style="margin:20px 0 0">' + modeDescription() + '<br>本项目预置内容为示例，不代表真实调研或真实实验室业务。</div><div class="form-actions">' + button('知道了', 'close-modal', 'check', 'primary') + '</div>');
  }
  function resetModal() {
    if (!admin()) return;
    showModal('重置示例数据？', note('<strong>这会替换当前模式中的整套数据。</strong> 你新增的耗材、阈值修改和出入库记录将被移除，并恢复预置示例。请先导出需要保留的记录。', 'warning') + '<p class="modal-description">重置范围：' + (mode === 'server' ? '当前本机 Python 服务的示例数据库。' : '当前浏览器中的演示数据，不影响其他浏览器。') + '</p><div class="form-error" id="reset-error" role="alert"></div><div class="form-actions">' + button('确认重置示例数据', 'confirm-reset', 'refresh', 'danger') + button('取消', 'close-modal', '', '') + '</div>');
  }

  function toast(message, error) {
    var el = document.createElement('div'); el.className = 'toast' + (error ? ' error' : ''); el.setAttribute('role', error ? 'alert' : 'status');
    el.innerHTML = icon(error ? 'info' : 'check') + '<span>' + esc(message) + '</span><button class="toast-close" aria-label="关闭通知">×</button>';
    el.querySelector('button').addEventListener('click', function () { el.remove(); }); toastRoot.appendChild(el); window.setTimeout(function () { el.remove(); }, 6500);
  }
  function errorMessage(error) { return error && error.message ? error.message : '操作未完成，请稍后重试。'; }
  function isAuthError(error) { return error && (error.code === 'AUTH_REQUIRED' || error.code === 'UNAUTHENTICATED' || error.status === 401); }
  async function loadData() { data = await API.state(); mode = data.mode || API.mode || mode; if (!data.user) throw Object.assign(new Error('请重新登录。'), { code: 'AUTH_REQUIRED' }); data.users = data.users || []; data.items = data.items || []; data.movements = data.movements || []; }
  async function refresh() {
    if (busy) return; busy = true;
    try { await loadData(); renderShell(); toast('已刷新最新数据。'); } catch (e) { if (isAuthError(e)) { data = null; renderLogin('登录已失效，请重新登录。'); } else toast(errorMessage(e), true); } finally { busy = false; }
  }
  function navigate(id) {
    if (busy) return;
    route = id; var url = new URL(window.location.href); url.searchParams.set('app', id); window.history.pushState({ app: id }, '', url);
    document.body.classList.remove('sidebar-open'); renderPage(); window.scrollTo(0, 0);
  }
  function integer(value, label, min) { var num = Number(value); if (String(value).trim() === '' || !Number.isSafeInteger(num) || num < min || num > 1000000000) throw new Error(label + '必须为 ' + min + ' 到 1,000,000,000 之间的整数。'); return num; }
  function formError(form, message) { var el = form.querySelector('.form-error'); if (el) { el.textContent = message; el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } }
  async function submitForm(form) {
    if (busy) return; var kind = form.dataset.form; var fd = new FormData(form);
    if (kind === 'filter') {
      var key = form.dataset.key; var next = Object.assign({}, filters[key]); fd.forEach(function (v, k) { next[k] = String(v); });
      if (next.start && next.end && next.start > next.end) { toast('开始日期不能晚于结束日期。', true); return; }
      filters[key] = next; pages[key] = 1; renderPage(); return;
    }
    var submit = form.querySelector('[type="submit"]'); var oldLabel = submit ? submit.innerHTML : ''; busy = true;
    if (submit) { submit.disabled = true; submit.innerHTML = '<span class="spinner"></span>正在保存…'; }
    formError(form, '');
    try {
      if (kind === 'setup') {
        await API.setupAdmin({username:String(fd.get('username')).trim(),display_name:String(fd.get('display_name')).trim(),password:String(fd.get('password')),setup_token:String(fd.get('setup_token'))});
        setupState={needs_setup:false,configured:true};busy=false;renderLogin('管理员已创建，请用刚设置的账号和密码登录。');
      } else if (kind === 'create-user') {
        await API.createUser({username:String(fd.get('username')).trim(),display_name:String(fd.get('display_name')).trim(),role:String(fd.get('role')),password:String(fd.get('password'))});
        await loadData();busy=false;closeModal();renderShell();toast('成员账号已创建。');
      } else if (kind === 'edit-user') {
        await API.updateUser(form.dataset.id,{display_name:String(fd.get('display_name')).trim(),role:String(fd.get('role')),active:fd.get('active')==='true'});
        await loadData();busy=false;closeModal();renderShell();toast('成员信息已更新。');
      } else if (kind === 'user-password') {
        await API.resetUserPassword(form.dataset.id,String(fd.get('new_password')));busy=false;closeModal();toast('密码已重设，旧会话已失效。');
      } else if (kind === 'self-password') {
        await API.changePassword(String(fd.get('current_password')),String(fd.get('new_password')));data=null;busy=false;closeModal();renderLogin('密码已修改，请使用新密码重新登录。');
      } else if (kind === 'login') {
        if (submit) submit.innerHTML = '<span class="spinner"></span>正在登录…';
        var session = await API.login(String(fd.get('username')).trim(), String(fd.get('password'))); mode = session.mode || API.mode || mode;
        await loadData(); reconciliation = null; renderShell(); toast('登录成功。');
      } else if (kind === 'item') {
        if (!admin()) throw new Error('只有管理员可以修改耗材档案。');
        var id = form.dataset.id; var payload = { name: String(fd.get('name')).trim(), spec: String(fd.get('spec') || '').trim(), location: String(fd.get('location') || '').trim(), min_stock: integer(fd.get('min_stock'), '预警下限', 0) };
        if (!payload.name) throw new Error('请填写耗材名称。');
        if (id) { payload.active = fd.get('active') === 'true'; await API.updateItem(id, payload); }
        else { payload.code = String(fd.get('code')).trim(); payload.unit = String(fd.get('unit')).trim(); if (!payload.code || !payload.unit) throw new Error('编码和固定单位不能为空。'); await API.createItem(payload); }
        await loadData(); reconciliation = null; busy = false; closeModal(); renderShell(); toast(id ? '耗材档案已更新。' : '耗材已创建，初始库存为 0。');
      } else if (kind === 'threshold') {
        if (!admin()) throw new Error('只有管理员可以设置预警下限。');
        await API.updateItem(String(fd.get('item_id')), { min_stock: integer(fd.get('min_stock'), '预警下限', 0) });
        await loadData(); busy = false; closeModal(); renderShell(); toast('预警下限已保存，提醒列表已更新。');
      } else if (kind === 'movement') {
        if (!admin()) throw new Error('只有管理员可以登记出入库。');
        var type = form.dataset.type; var d = drafts[type];
        if (!d.posted) { d.item_id = String(fd.get('item_id') || ''); d.quantity = String(fd.get('quantity') || ''); d.recipient_id = type === 'OUT' ? String(fd.get('recipient_id') || '') : ''; d.note = String(fd.get('note') || ''); }
        if (!d.item_id) throw new Error('请选择一个耗材。'); if (type === 'OUT' && !d.recipient_id) throw new Error('请选择领用成员。');
        var movementPayload = { business_no: d.business_no, item_id: d.item_id, type: type, quantity: integer(d.quantity, '登记数量', 1), recipient_id: type === 'OUT' ? d.recipient_id : null, note: d.note.trim() };
        var response = await API.postMovement(movementPayload); d.posted = response;
        await loadData(); reconciliation = null; renderShell(); toast(response.idempotent ? '已找到原记录，本次没有重复记账。' : (type === 'IN' ? '入库成功，库存已更新。' : '领用成功，库存已更新。'));
      }
    } catch (error) {
      if (isAuthError(error) && kind !== 'login') { data = null; busy = false; closeModal(); renderLogin('登录已失效，请重新登录。'); }
      else formError(form, errorMessage(error));
    } finally { busy = false; if (submit && submit.isConnected) { submit.disabled = false; submit.innerHTML = oldLabel; } }
  }

  function csvCell(value) {
    var s = String(value == null ? '' : value);
    if (typeof value !== 'number' && (/^[\s]*[=+\-@]/.test(s) || /^[\t\r\n]/.test(s))) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  }
  function exportCSV(kind) {
    var rows = []; var label = kind;
    if (kind === 'items' || kind === 'inventory' || kind === 'alerts') {
      label = kind === 'items' ? '耗材档案' : kind === 'inventory' ? '库存查询' : '低库存预警';
      rows.push(['编码', '名称', '规格', '固定单位', '存放位置', '当前库存', '预警下限', '启用状态']);
      (kind === 'alerts' ? filteredAlerts() : filteredItems(kind)).forEach(function (x) { rows.push([x.code, x.name, x.spec, x.unit, x.location, x.current_stock, x.min_stock, x.active ? '启用' : '停用']); });
    } else if (kind === 'movements') {
      label = admin() ? '出入库流水' : '本人领用记录'; rows.push(['业务单号', '时间（Asia/Shanghai）', '耗材编码', '耗材名称', '业务类型', '数量', '单位', '领用人'].concat(admin() ? ['经办人'] : []).concat(['说明']));
      filteredMovements('movements').forEach(function (m) { var x = itemById(m.item_id) || {}; rows.push([m.business_no, dateTime(m.created_at), x.code, x.name, m.type === 'IN' ? '入库' : '领用', m.quantity, x.unit, userName(m.recipient_id)].concat(admin() ? [userName(m.operator_id)] : []).concat([m.note])); });
    } else if (kind === 'reconciliation' && reconciliation) {
      label = '全历史库存核对'; rows.push(['核对时间', '耗材编码', '耗材名称', '全部入库', '全部领用', '流水净额', '当前库存', '差额', '结果']);
      reconciliation.rows.forEach(function (x) { rows.push([dateTime(reconciliation.checked_at), x.code, x.name, x.inbound, x.outbound, x.ledger_stock, x.current_stock, x.difference, x.difference === 0 ? '一致' : '需核查']); });
    } else if (kind === 'statistics') {
      label = admin() ? '数据统计' : '本人领用统计'; var s = statisticsData(); var f = filters.statistics;
      rows.push(['统计范围', f.start || '最早记录', f.end || '最新记录']); rows.push(['可见业务记录数', s.records.length]); rows.push(['固定单位'].concat(admin() ? ['入库数量'] : []).concat(['领用数量']));
      s.units.forEach(function (u) { rows.push([u.unit].concat(admin() ? [u.inbound] : []).concat([u.outbound])); });
      rows.push([]); rows.push(['耗材名称', '领用笔数', '领用数量', '单位']); s.ranks.forEach(function (r) { rows.push([r.item.name, r.count, r.quantity, r.item.unit]); });
    }
    if (!rows.length) { toast('暂无可导出的结果。', true); return; }
    var content = '\uFEFF' + rows.map(function (r) { return r.map(csvCell).join(','); }).join('\r\n');
    var url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8;' })); var a = document.createElement('a'); a.href = url; a.download = 'LabFlow_' + label + '_' + today() + '.csv'; document.body.appendChild(a); a.click(); a.remove(); window.setTimeout(function () { URL.revokeObjectURL(url); }, 1500); toast('已导出当前筛选范围的数据。');
  }

  async function handleAction(el) {
    var action = el.dataset.action;
    if (action === 'close-modal') { closeModal(); return; }
    if (action === 'menu' || action === 'menu-close') { document.body.classList.toggle('sidebar-open', action === 'menu'); return; }
    if (action === 'toggle-password') { var password = document.getElementById('password'); password.type = password.type === 'password' ? 'text' : 'password'; el.setAttribute('aria-label', password.type === 'password' ? '显示密码' : '隐藏密码'); return; }
    if (busy) return;
    else if (action === 'help') helpModal();
    else if (action === 'create-user') userModal();
    else if (action === 'edit-user') userModal(el.dataset.id);
    else if (action === 'user-password') passwordModal(el.dataset.id);
    else if (action === 'change-password') passwordModal();
    else if (action === 'refresh') await refresh();
    else if (action === 'create-item') itemModal();
    else if (action === 'edit-item') itemModal(el.dataset.id);
    else if (action === 'threshold') thresholdModal(el.dataset.id);
    else if (action === 'reset') resetModal();
    else if (action === 'export') exportCSV(el.dataset.kind);
    else if (action === 'page') { var key = el.dataset.key; pages[key] = (pages[key] || 1) + Number(el.dataset.step); renderPage(); }
    else if (action === 'clear-filter') { var k = el.dataset.key; Object.keys(filters[k]).forEach(function (name) { filters[k][name] = name === 'active' || name === 'status' ? 'all' : ''; }); pages[k] = 1; renderPage(); }
    else if (action === 'new-movement') { drafts[el.dataset.type] = newDraft(el.dataset.type); renderPage(); }
    else if (action === 'quick-movement') { var t = el.dataset.type; drafts[t] = newDraft(t); drafts[t].item_id = el.dataset.id; navigate(t === 'IN' ? 'inbound' : 'outbound'); }
    else if (action === 'item-movements') { filters.movements = { q: '', type: '', item_id: el.dataset.id, start: '', end: '', recipient_id: '' }; pages.movements = 1; navigate('movements'); }
    else if (action === 'logout') {
      busy = true; try { await API.logout(); data = null; reconciliation = null; drafts = { IN: newDraft('IN'), OUT: newDraft('OUT') }; Object.keys(filters).forEach(function (k) { Object.keys(filters[k]).forEach(function (name) { filters[k][name] = name === 'active' || name === 'status' ? 'all' : ''; }); }); pages = {}; renderLogin(); toast('已退出登录。'); } catch (e) { toast(errorMessage(e), true); } finally { busy = false; }
    } else if (action === 'toggle-item') {
      if (!admin()) return; var item = itemById(el.dataset.id); if (!item) return; busy = true; el.disabled = true;
      try { await API.updateItem(item.id, { active: !item.active }); await loadData(); reconciliation = null; renderShell(); toast(item.active ? '已停用耗材，历史记录保留。' : '已启用耗材。'); } catch (e) { toast(errorMessage(e), true); } finally { busy = false; if (el.isConnected) el.disabled = false; }
    } else if (action === 'reconcile') {
      if (!admin()) return; busy = true; el.disabled = true; var original = el.innerHTML; el.innerHTML = '<span class="spinner"></span>正在核对…';
      try { reconciliation = await API.reconcile(); renderPage(); toast('已完成全部历史库存核对。'); } catch (e) { toast(errorMessage(e), true); } finally { busy = false; if (el.isConnected) { el.disabled = false; el.innerHTML = original; } }
    } else if (action === 'confirm-reset') {
      if (!admin()) return; busy = true; el.disabled = true;
      try { await API.resetDemo(); reconciliation = null; drafts = { IN: newDraft('IN'), OUT: newDraft('OUT') }; pages = {}; busy = false; closeModal(); var session = await API.session(); mode = session.mode || mode; if (session.user) { await loadData(); renderShell(); } else { data = null; renderLogin(); } toast('示例数据已恢复。'); } catch (e) { var err = document.getElementById('reset-error'); if (err) err.textContent = errorMessage(e); else toast(errorMessage(e), true); } finally { busy = false; if (el.isConnected) el.disabled = false; }
    }
  }

  function onClick(event) {
    var nav = event.target.closest('[data-nav]');
    if (nav && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) { event.preventDefault(); navigate(nav.dataset.nav); return; }
    var account = event.target.closest('[data-account]');
    if (account) { var user = document.getElementById('username'); var pass = document.getElementById('password'); if (user && pass) { user.value = account.dataset.account; pass.value = account.dataset.account === 'admin' ? 'Admin123!' : 'Member123!'; var submit = user.form.querySelector('[type="submit"]'); if (submit) submit.focus(); } return; }
    var action = event.target.closest('[data-action]'); if (action) { event.preventDefault(); handleAction(action).catch(function (e) { toast(errorMessage(e), true); }); }
    else if (event.target.dataset.backdrop === 'true') closeModal();
  }
  root.addEventListener('click', onClick); modalRoot.addEventListener('click', onClick);
  function onSubmit(event) { var form = event.target.closest('form[data-form]'); if (!form) return; event.preventDefault(); submitForm(form).catch(function (e) { busy = false; formError(form, errorMessage(e)); }); }
  root.addEventListener('submit', onSubmit); modalRoot.addEventListener('submit', onSubmit);
  function updateDraft(event) { var form = event.target.closest('form[data-form="movement"]'); if (!form) return; var type = form.dataset.type; var draft = drafts[type]; if (draft.posted) return; if (['item_id', 'quantity', 'recipient_id', 'note'].indexOf(event.target.name) !== -1) { draft[event.target.name] = event.target.value; if (event.target.name === 'item_id' || event.target.name === 'quantity') updateStockPreview(type); } }
  root.addEventListener('input', updateDraft); root.addEventListener('change', updateDraft);
  modalRoot.addEventListener('change', function (event) { if (event.target.id === 'threshold-item') { var x = itemById(event.target.value); if (x) { document.getElementById('threshold-value').value = x.min_stock; document.getElementById('threshold-help').textContent = '当前库存 ' + number(x.current_stock) + ' ' + x.unit; } } });
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') { closeModal(); document.body.classList.remove('sidebar-open'); }
    if (event.key === 'Tab' && modalRoot.firstChild) { var nodes = Array.from(modalRoot.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex="0"]')); var first = nodes[0]; var last = nodes[nodes.length - 1]; if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); } }
  });
  window.addEventListener('popstate', function () { route = readRoute(); if (data) renderPage(); });

  async function init() {
    try {
      if (!API) throw new Error('数据模块未加载，请确认项目文件完整后重新打开。');
      await API.init(); mode = API.mode || 'browser'; var session = await API.session(); mode = session.mode || mode; cloudMode = !!session.cloud;
      if (session.user) { await loadData(); renderShell(); }
      else if (cloudMode) { setupState = await API.setupStatus(); if (setupState.needs_setup) renderSetup(); else renderLogin(); }
      else renderLogin();
    } catch (e) {
      root.innerHTML = '<main class="boot-screen" id="main-content"><span class="boot-mark">L</span><h1>暂时无法打开工作台</h1><p style="max-width:440px;text-align:center;padding:0 20px">' + esc(errorMessage(e)) + '</p><button class="btn primary" id="retry-boot">重新尝试</button><p class="small" style="max-width:440px;text-align:center;padding:0 20px">如果使用本机版，请确认 Python 服务仍在运行。已建立的本机连接不会自动切换到另一套数据。</p></main>';
      document.getElementById('retry-boot').addEventListener('click', init);
    }
  }
  init();
})();
