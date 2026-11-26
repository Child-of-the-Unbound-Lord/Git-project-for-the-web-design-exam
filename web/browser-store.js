/* Browser demonstration store. Real authentication is provided by server.py.
 * Persisted data lives in one IndexedDB record. Every write reads and replaces
 * that record in ONE readwrite transaction; no shared in-memory stock cache.
 * Overlapping transactions are serialized by IndexedDB, including other tabs:
 * https://www.w3.org/TR/IndexedDB-2/#transaction-scheduling
 */
(function (root, factory) {
  'use strict';
  const exported = factory();
  if (typeof module === 'object' && module.exports) module.exports = exported;
  else Object.defineProperty(root, 'BrowserStore', { value: exported.createBrowserStore(root), writable: false });
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  const MAX_QTY = 1000000000;
  const VERSION = 1;
  const DB_NAME = 'lab-miniapps-demo-v1';
  const STORE_NAME = 'state';
  const STATE_KEY = 'current';
  const SESSION_KEY = 'lab-miniapps-demo-identity';
  // These are public sample credentials, never persisted in IndexedDB/storage.
  const SAMPLE_ACCOUNTS = Object.freeze({
    admin: { id: 'U_ADMIN', password: 'Admin123!' },
    member_a: { id: 'U_A', password: 'Member123!' },
    member_b: { id: 'U_B', password: 'Member123!' }
  });

  function fault(code, message, status) {
    const e = new Error(message);
    e.code = code;
    e.status = status || 400;
    return e;
  }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function own(object, key) { return Object.prototype.hasOwnProperty.call(object, key); }
  function checkObject(value, allowed) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw fault('VALIDATION_ERROR', '提交内容必须是对象。');
    for (const key of Object.keys(value)) {
      if (!allowed.includes(key)) throw fault('VALIDATION_ERROR', '不允许修改字段：' + key);
    }
  }
  function text(value, label, maximum, required) {
    if (value === undefined || value === null) {
      if (!required) return '';
      throw fault('VALIDATION_ERROR', label + '不能为空。');
    }
    if (typeof value !== 'string') throw fault('VALIDATION_ERROR', label + '必须是文本。');
    const result = value.trim();
    if (required && !result) throw fault('VALIDATION_ERROR', label + '不能为空。');
    if (result.length > maximum) throw fault('VALIDATION_ERROR', label + '不能超过 ' + maximum + ' 个字符。');
    return result;
  }
  function quantity(value, label, minimum) {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > MAX_QTY) {
      throw fault('VALIDATION_ERROR', label + '必须为 ' + minimum + ' 至 ' + MAX_QTY + ' 的整数。');
    }
    return value;
  }
  function boolean(value, label) {
    if (typeof value !== 'boolean') throw fault('VALIDATION_ERROR', label + '必须为启用或停用。');
    return value;
  }
  function checkState(state) {
    if (!state || state.schema_version !== VERSION || !Array.isArray(state.users) || !Array.isArray(state.items) || !Array.isArray(state.movements)) {
      throw fault('STORE_FORMAT_ERROR', '浏览器演示数据格式无法识别。请先备份数据，再由管理员确认是否重置；也可使用本地 Python 版。', 500);
    }
  }
  function publicUser(user) {
    return { id: user.id, username: user.username, display_name: user.display_name, role: user.role };
  }
  function auth(state, actorId, adminOnly) {
    checkState(state);
    const user = state.users.find(u => u.id === actorId);
    if (!user) throw fault('AUTH_REQUIRED', '请先使用示例账号登录。', 401);
    if (adminOnly && user.role !== 'admin') throw fault('FORBIDDEN', '此操作需要管理员身份。', 403);
    return user;
  }
  function itemAt(state, id) {
    const found = state.items.find(i => i.id === id);
    if (!found) throw fault('NOT_FOUND', '没有找到该耗材，请刷新列表后重试。', 404);
    return found;
  }
  function nextId(state, kind) {
    const field = kind === 'item' ? 'next_item' : 'next_movement';
    const collection = kind === 'item' ? state.items : state.movements;
    const prefix = kind === 'item' ? 'ITEM_' : 'MOV_';
    if (!Number.isSafeInteger(state[field]) || state[field] < 1) state[field] = collection.length + 1;
    let id;
    do { id = prefix + String(state[field]++).padStart(6, '0'); } while (collection.some(x => x.id === id));
    return id;
  }
  function clock(value) {
    const parsed = value === undefined ? new Date() : new Date(value);
    if (!Number.isFinite(parsed.getTime())) throw fault('VALIDATION_ERROR', '时间格式不正确。');
    return parsed.toISOString();
  }

  function createItem(state, actorId, payload) {
    auth(state, actorId, true);
    checkObject(payload, ['code', 'name', 'spec', 'unit', 'location', 'min_stock', 'active']);
    const fields = {
      code: text(payload.code, '耗材编码', 64, true),
      name: text(payload.name, '耗材名称', 120, true),
      spec: text(payload.spec, '规格', 200, false),
      unit: text(payload.unit, '计数单位', 30, true),
      location: text(payload.location, '存放位置', 200, false),
      min_stock: quantity(payload.min_stock === undefined ? 0 : payload.min_stock, '库存下限', 0),
      current_stock: 0,
      active: payload.active === undefined ? true : boolean(payload.active, '启用状态')
    };
    if (state.items.some(i => i.code === fields.code)) throw fault('DUPLICATE_CODE', '耗材编码已存在，请使用不同编码。', 409);
    const changed = clone(state);
    const item = Object.assign({ id: nextId(changed, 'item') }, fields);
    changed.items.push(item);
    return { state: changed, data: { item: clone(item) } };
  }
  function updateItem(state, actorId, id, payload) {
    auth(state, actorId, true);
    id = text(id, '耗材标识', 100, true);
    const existing = itemAt(state, id);
    checkObject(payload, ['name', 'spec', 'location', 'min_stock', 'active']);
    const fields = {};
    if (own(payload, 'name')) fields.name = text(payload.name, '耗材名称', 120, true);
    if (own(payload, 'spec')) fields.spec = text(payload.spec, '规格', 200, false);
    if (own(payload, 'location')) fields.location = text(payload.location, '存放位置', 200, false);
    if (own(payload, 'min_stock')) fields.min_stock = quantity(payload.min_stock, '库存下限', 0);
    if (own(payload, 'active')) fields.active = boolean(payload.active, '启用状态');
    const changed = clone(state);
    const item = itemAt(changed, existing.id);
    Object.assign(item, fields);
    return { state: changed, data: { item: clone(item) } };
  }
  function normalizedMovement(payload, operatorId) {
    checkObject(payload, ['business_no', 'item_id', 'type', 'quantity', 'recipient_id', 'note']);
    const type = text(payload.type, '流水类型', 3, true);
    if (!['IN', 'OUT'].includes(type)) throw fault('VALIDATION_ERROR', '流水类型只能为 IN 或 OUT。');
    return {
      business_no: text(payload.business_no, '业务单号', 100, true),
      item_id: text(payload.item_id, '耗材标识', 100, true),
      type,
      quantity: quantity(payload.quantity, type === 'IN' ? '入库数量' : '领用数量', 1),
      recipient_id: type === 'IN' ? null : text(payload.recipient_id, '领用人', 100, true),
      operator_id: operatorId,
      note: text(payload.note, '备注', 500, false)
    };
  }
  function postMovement(state, actorId, payload, now) {
    const user = auth(state, actorId, true); // Authorization also applies to retries.
    const normalized = normalizedMovement(payload, user.id);
    const previous = state.movements.find(m => m.business_no === normalized.business_no);
    if (previous) {
      if (!Object.keys(normalized).every(k => previous[k] === normalized[k])) {
        throw fault('BUSINESS_NO_CONFLICT', '此业务单号已用于不同内容，请核对原记录或更换单号。', 409);
      }
      // Check replay before active/stock validation: a retry remains valid after
      // later movements or deactivation and returns the refreshed stock value.
      return { state, data: { movement: clone(previous), idempotent: true, current_stock: itemAt(state, previous.item_id).current_stock } };
    }
    const item = itemAt(state, normalized.item_id);
    if (!item.active) throw fault('ITEM_INACTIVE', '该耗材已停用；启用后才能新增出入库。', 409);
    if (normalized.type === 'OUT' && !state.users.some(u => u.id === normalized.recipient_id && u.role === 'member')) {
      throw fault('INVALID_RECIPIENT', '请选择有效的普通成员作为领用人。');
    }
    const updatedStock = item.current_stock + (normalized.type === 'IN' ? normalized.quantity : -normalized.quantity);
    if (updatedStock < 0) throw fault('INSUFFICIENT_STOCK', '当前库存不足，请减少领用数量或先补货。', 409);
    if (!Number.isSafeInteger(updatedStock) || updatedStock > MAX_QTY) throw fault('STOCK_LIMIT', '入库后库存将超过 ' + MAX_QTY + '，请核对数量。', 409);
    const changed = clone(state);
    const movement = Object.assign({ id: nextId(changed, 'movement') }, normalized, { created_at: clock(now) });
    itemAt(changed, item.id).current_stock = updatedStock;
    changed.movements.push(movement);
    return { state: changed, data: { movement: clone(movement), idempotent: false, current_stock: updatedStock } };
  }
  function viewState(state, actorId) {
    const user = auth(state, actorId, false);
    return {
      user: publicUser(user),
      users: (user.role === 'admin' ? state.users : [user]).map(publicUser),
      items: clone(state.items),
      movements: clone(user.role === 'admin' ? state.movements : state.movements.filter(m => m.type === 'OUT' && m.recipient_id === user.id)),
      mode: 'browser'
    };
  }
  function chinaDay(timestamp) {
    const n = new Date(timestamp).getTime();
    if (!Number.isFinite(n)) throw fault('STORE_FORMAT_ERROR', '流水时间无法识别，请核对数据。', 500);
    return new Date(n + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
  }
  function dateFilter(value, label) {
    if (value === undefined || value === null || value === '') return '';
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw fault('VALIDATION_ERROR', label + '应为 YYYY-MM-DD。');
    const date = new Date(value + 'T00:00:00Z');
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw fault('VALIDATION_ERROR', label + '不是有效日期。');
    return value;
  }
  function movements(state, actorId, filters) {
    const user = auth(state, actorId, false);
    filters = filters || {};
    checkObject(filters, ['item_id', 'type', 'start', 'end', 'recipient_id']);
    const requestedRecipient = text(filters.recipient_id, '领用人', 100, false);
    if (user.role === 'member' && requestedRecipient && requestedRecipient !== user.id) {
      throw fault('FORBIDDEN', '普通成员只能查询本人的领用记录。', 403);
    }
    const itemId = text(filters.item_id, '耗材标识', 100, false);
    const type = text(filters.type, '流水类型', 3, false);
    if (type && !['IN', 'OUT'].includes(type)) throw fault('VALIDATION_ERROR', '流水类型只能为 IN 或 OUT。');
    const start = dateFilter(filters.start, '开始日期');
    const end = dateFilter(filters.end, '结束日期');
    if (start && end && start > end) throw fault('VALIDATION_ERROR', '开始日期不能晚于结束日期。');
    const rows = state.movements.filter(m => {
      if (user.role === 'member' && (m.type !== 'OUT' || m.recipient_id !== user.id)) return false;
      if (requestedRecipient && m.recipient_id !== requestedRecipient) return false;
      if (itemId && m.item_id !== itemId) return false;
      if (type && m.type !== type) return false;
      if (start || end) { const day = chinaDay(m.created_at); if ((start && day < start) || (end && day > end)) return false; }
      return true;
    });
    return { movements: clone(rows) };
  }
  function reconcile(state, actorId, now) {
    auth(state, actorId, true);
    const totals = new Map(state.items.map(i => [i.id, { inbound: 0, outbound: 0 }]));
    // Deliberately all historical rows. No date/visibility filters are accepted.
    for (const m of state.movements) {
      const row = totals.get(m.item_id);
      if (row) row[m.type === 'IN' ? 'inbound' : 'outbound'] += m.quantity;
    }
    const rows = state.items.map(item => {
      const total = totals.get(item.id);
      const ledger = total.inbound - total.outbound;
      return { item_id: item.id, code: item.code, name: item.name, current_stock: item.current_stock,
        inbound: total.inbound, outbound: total.outbound, ledger_stock: ledger,
        difference: item.current_stock - ledger, active: item.active };
    });
    return { rows, checked_at: clock(now) };
  }
  function alerts(state, actorId) {
    auth(state, actorId, false);
    return clone(state.items.filter(i => i.active && i.current_stock <= i.min_stock));
  }
  function login(state, username, password) {
    checkState(state);
    const name = typeof username === 'string' ? username.trim() : '';
    const account = own(SAMPLE_ACCOUNTS, name) ? SAMPLE_ACCOUNTS[name] : null;
    if (!account || typeof password !== 'string' || account.password !== password) {
      throw fault('INVALID_CREDENTIALS', '账号或密码不正确，请使用页面列出的示例账号。', 401);
    }
    const user = state.users.find(u => u.id === account.id && u.username === name);
    if (!user) throw fault('INVALID_CREDENTIALS', '该示例账号未在当前数据集中配置。', 401);
    return publicUser(user);
  }
  function createSeed(seed, now) {
    if (!seed || !Array.isArray(seed.users) || !Array.isArray(seed.items)) throw fault('SEED_MISSING', '示例数据未加载，请检查 seed-data.js 是否与页面位于同一目录。', 500);
    const state = { schema_version: VERSION, users: [], items: [], movements: [], next_item: 1, next_movement: 1 };
    for (const raw of seed.users) {
      const user = { id: text(raw.id, '用户标识', 100, true), username: text(raw.username, '账号', 64, true),
        display_name: text(raw.display_name, '显示名称', 120, true), role: raw.role };
      if (!['admin', 'member'].includes(user.role) || state.users.some(u => u.id === user.id || u.username === user.username)) throw fault('SEED_INVALID', '示例用户数据有重复或角色不正确。', 500);
      state.users.push(user); // Explicit fields omit any accidental password data.
    }
    const administrator = state.users.find(u => u.role === 'admin');
    const members = state.users.filter(u => u.role === 'member');
    if (!administrator) throw fault('SEED_INVALID', '示例数据缺少管理员。', 500);
    const baseTime = new Date(clock(now)).getTime();
    let current = state;
    seed.items.forEach((raw, index) => {
      const itemResult = createItem(current, administrator.id, { code: raw.code, name: raw.name, spec: raw.spec,
        unit: raw.unit, location: raw.location, min_stock: raw.min_stock, active: true });
      current = itemResult.state;
      const added = current.items[current.items.length - 1];
      if (raw.id !== undefined) {
        const id = text(raw.id, '耗材标识', 100, true);
        if (current.items.slice(0, -1).some(i => i.id === id)) throw fault('SEED_INVALID', '示例耗材标识重复。', 500);
        added.id = id;
      }
      const itemId = added.id;
      const opening = quantity(raw.opening_qty === undefined ? 0 : raw.opening_qty, '期初入库', 0);
      const issued = quantity(raw.issued_qty === undefined ? 0 : raw.issued_qty, '示例领用', 0);
      const earlier = baseTime - (seed.items.length - index) * 2 * 86400000;
      if (opening > 0) current = postMovement(current, administrator.id, { business_no: 'DEMO-IN-' + itemId, item_id: itemId, type: 'IN', quantity: opening,
        note: '演示数据：期初入库，非真实实验记录' }, earlier).state;
      if (issued > 0) {
        const recipient = raw.recipient_id || (members.length ? members[index % members.length].id : '');
        current = postMovement(current, administrator.id, { business_no: 'DEMO-OUT-' + itemId, item_id: itemId, type: 'OUT', quantity: issued, recipient_id: recipient,
          note: '演示数据：示例领用，非真实实验记录' }, earlier + 86400000).state;
      }
      if (raw.active !== undefined) current = updateItem(current, administrator.id, itemId, { active: raw.active }).state;
    });
    return current;
  }

  const Domain = Object.freeze({ MAX_QTY, createSeed, createItem, updateItem, postMovement, viewState, movements, reconcile, alerts, login, chinaDay });

  function createBrowserStore(env) {
    let opening = null;
    let initialized = null;
    let identity = null;
    try { identity = env.sessionStorage.getItem(SESSION_KEY); } catch (_) { /* Login remains tab-local if sessionStorage is unavailable. */ }
    function setIdentity(id) {
      identity = id;
      try { if (id) env.sessionStorage.setItem(SESSION_KEY, id); else env.sessionStorage.removeItem(SESSION_KEY); } catch (_) { /* Never persist credentials. */ }
    }
    function storageError(cause) {
      if (cause && cause.code && typeof cause.code === 'string') return cause;
      const quota = cause && cause.name === 'QuotaExceededError';
      return fault(quota ? 'STORAGE_FULL' : 'STORAGE_UNAVAILABLE', quota
        ? '浏览器存储空间不足，本次操作未保存。请释放空间后重试，或使用本地 Python 版。'
        : '当前浏览器无法使用 IndexedDB 持久存储，本次操作未保存。请换用支持本地存储的浏览器，或运行项目的本地 Python 版。', 500);
    }
    function openDatabase() {
      if (opening) return opening;
      opening = new Promise((resolve, reject) => {
        let request;
        let rejected = false;
        try {
          if (!env.indexedDB) throw new Error('IndexedDB is unavailable');
          request = env.indexedDB.open(DB_NAME, VERSION);
        } catch (e) { reject(storageError(e)); return; }
        request.onupgradeneeded = () => {
          if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
        };
        request.onerror = () => { rejected = true; reject(storageError(request.error)); };
        request.onblocked = () => { rejected = true; reject(fault('STORAGE_BLOCKED', '其他标签页正在使用旧版演示数据，请关闭这些页面后重试。', 409)); };
        request.onsuccess = () => {
          const db = request.result;
          if (rejected) { db.close(); return; }
          db.onversionchange = () => { db.close(); opening = null; initialized = null; };
          resolve(db);
        };
      });
      opening.catch(() => { opening = null; });
      return opening;
    }
    async function transaction(mode, action) {
      const db = await openDatabase();
      return new Promise((resolve, reject) => {
        let tx;
        let result;
        let failure = null;
        try { tx = db.transaction(STORE_NAME, mode); } catch (e) { reject(storageError(e)); return; }
        tx.oncomplete = () => resolve(result);
        tx.onabort = () => reject(failure || storageError(tx.error));
        tx.onerror = () => { if (!failure) failure = storageError(tx.error); };
        const objectStore = tx.objectStore(STORE_NAME);
        const request = objectStore.get(STATE_KEY);
        request.onerror = () => { failure = storageError(request.error); };
        request.onsuccess = () => {
          // Keep the entire read/validate/write synchronous inside the success
          // callback: awaiting here could make the IndexedDB transaction inactive.
          try {
            const outcome = action(request.result);
            if (outcome && own(outcome, 'state')) {
              if (mode !== 'readwrite') throw new Error('Read-only transaction attempted a write');
              objectStore.put(outcome.state, STATE_KEY);
            }
            result = outcome ? outcome.data : undefined;
          } catch (e) {
            failure = e && e.code ? e : storageError(e);
            tx.abort();
          }
        };
      });
    }
    function ensureInitialized() {
      if (!initialized) {
        initialized = transaction('readwrite', existing => {
          if (existing !== undefined) { checkState(existing); return { data: true }; }
          return { state: createSeed(env.LabSeed), data: true };
        });
        initialized.catch(() => { initialized = null; });
      }
      return initialized;
    }
    async function read(action) {
      await ensureInitialized();
      return transaction('readonly', state => { checkState(state); return { data: action(state) }; });
    }
    async function write(action) {
      await ensureInitialized();
      return transaction('readwrite', state => { checkState(state); return action(state); });
    }
    const api = {
      mode: 'browser',
      async init() { await ensureInitialized(); return api.session(); },
      async session() {
        const id = identity;
        return read(state => ({ user: state.users.some(u => u.id === id) ? publicUser(state.users.find(u => u.id === id)) : null, mode: 'browser' }));
      },
      async login(username, password) {
        const user = await read(state => login(state, username, password));
        setIdentity(user.id);
        return { user, mode: 'browser' };
      },
      async logout() { setIdentity(null); return { user: null, mode: 'browser' }; },
      async state() { const actor = identity; return read(state => viewState(state, actor)); },
      async createItem(payload) { const actor = identity; return write(state => createItem(state, actor, payload)); },
      async updateItem(id, payload) { const actor = identity; return write(state => updateItem(state, actor, id, payload)); },
      async postMovement(payload) { const actor = identity; return write(state => postMovement(state, actor, payload)); },
      async movements(filters) { const actor = identity; return read(state => movements(state, actor, filters)); },
      async listMovements(filters) { return api.movements(filters); },
      async reconcile() { const actor = identity; return read(state => reconcile(state, actor)); },
      async resetDemo() {
        const actor = identity;
        return write(state => { auth(state, actor, true); return { state: createSeed(env.LabSeed), data: { reset: true } }; });
      }
    };
    return Object.freeze(api);
  }
  // The domain/test factory is exported only to Node; the browser gets solely
  // the bounded store interface above, with no hidden tamper or failure endpoint.
  return Object.freeze({ Domain, createBrowserStore });
});
