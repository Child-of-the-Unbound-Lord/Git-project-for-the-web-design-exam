/* One adapter for the authenticated local server and current-browser demo. */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = { createAPI: factory };
  else Object.defineProperty(root, 'LabAPI', { value: factory(root), writable: false });
})(typeof window !== 'undefined' ? window : globalThis, function (env) {
  'use strict';
  let selectedMode = null;
  let initializing = null;

  function error(code, message, status) {
    const e = new Error(message); e.code = code; e.status = status || 0; return e;
  }
  function responseError(response, body) {
    const detail = body && body.error;
    return error(detail && detail.code || 'SERVER_ERROR', detail && detail.message || ('服务器返回错误（HTTP ' + response.status + '），请重试。'), response.status);
  }
  function envelope(body) { return body && typeof body === 'object' && typeof body.ok === 'boolean' && (body.ok ? Object.prototype.hasOwnProperty.call(body, 'data') : !!body.error); }
  async function fetchJSON(path, options, probe) {
    if (typeof env.fetch !== 'function') throw error('NETWORK_ERROR', '浏览器不支持网络请求，请使用本地 Python 版。');
    const controller = typeof env.AbortController === 'function' ? new env.AbortController() : null;
    const timeout = controller ? env.setTimeout(() => controller.abort(), probe ? 3500 : 15000) : null;
    try {
      return await env.fetch(path, Object.assign({ credentials: 'same-origin', cache: 'no-store',
        headers: { Accept: 'application/json', ...(options && options.body ? { 'Content-Type': 'application/json' } : {}) },
        ...(controller ? { signal: controller.signal } : {}) }, options || {}));
    } catch (cause) {
      throw error('NETWORK_ERROR', cause && cause.name === 'AbortError'
        ? '连接服务器超时。请确认本地服务正在运行后重试；当前数据模式没有改变。'
        : '无法连接服务器。请确认本地服务正在运行后重试；当前数据模式没有改变。');
    } finally { if (timeout !== null) env.clearTimeout(timeout); }
  }
  async function request(path, method, payload) {
    const response = await fetchJSON(path, { method: method || 'GET', ...(payload === undefined ? {} : { body: JSON.stringify(payload) }) }, false);
    let body;
    try { body = await response.json(); } catch (_) { throw error('INVALID_RESPONSE', '服务器返回的内容不是有效 JSON。请检查服务日志后重试，当前数据模式没有改变。', response.status); }
    if (!response.ok || body && body.ok === false) throw responseError(response, body);
    if (!envelope(body) || body.ok !== true) throw error('INVALID_RESPONSE', '服务器响应格式不符合本项目接口。请检查本地服务，当前数据模式没有改变。', response.status);
    return body.data;
  }
  async function useBrowser() {
    selectedMode = 'browser';
    if (!env.BrowserStore || typeof env.BrowserStore.init !== 'function') throw error('STORE_MISSING', '浏览器演示数据层未加载，请检查 browser-store.js。');
    return env.BrowserStore.init();
  }
  async function detect() {
    if (env.location && env.location.protocol === 'file:') return useBrowser();
    let response;
    try { response = await fetchJSON('/api/session', { method: 'GET' }, true); }
    catch (failure) { throw failure; } // An unreachable server cannot silently become a separate local inventory.
    if (response.status === 404) return useBrowser();
    const contentType = response.headers && response.headers.get('content-type') || '';
    if (!/\bjson\b|\+json/i.test(contentType)) return useBrowser();
    let body;
    try { body = await response.json(); }
    catch (_) {
      selectedMode = 'server';
      throw error('INVALID_RESPONSE', '服务器声称返回 JSON，但内容无法解析。请检查本地服务。', response.status);
    }
    // A genuine JSON API error is still evidence of a server. Never hide it by
    // starting an unrelated local data set, even on the first initialization.
    if (!response.ok || body && body.ok === false) {
      selectedMode = 'server';
      throw responseError(response, body);
    }
    if (!envelope(body) || !body.data || !Object.prototype.hasOwnProperty.call(body.data, 'user')) return useBrowser();
    selectedMode = 'server';
    return Object.assign({}, body.data, { mode: 'server' });
  }
  async function init() {
    if (initializing) return initializing;
    if (selectedMode) return { mode: selectedMode };
    initializing = detect();
    try { return await initializing; } finally { initializing = null; }
  }
  async function call(browserMethod, path, method, payload, args) {
    await init();
    if (selectedMode === 'browser') return env.BrowserStore[browserMethod](...(args || []));
    return request(path, method, payload);
  }
  const api = {
    get mode() { return selectedMode; },
    init,
    async session() { return Object.assign({}, await call('session', '/api/session', 'GET'), { mode: selectedMode }); },
    async login(username, password) { return Object.assign({}, await call('login', '/api/login', 'POST', { username, password }, [username, password]), { mode: selectedMode }); },
    async logout() { return Object.assign({}, await call('logout', '/api/logout', 'POST', {}, []), { mode: selectedMode }); },
    async state() { return Object.assign({}, await call('state', '/api/state', 'GET'), { mode: selectedMode }); },
    async createItem(payload) { return call('createItem', '/api/items', 'POST', payload, [payload]); },
    async updateItem(id, payload) { return call('updateItem', '/api/items/' + encodeURIComponent(id), 'PATCH', payload, [id, payload]); },
    async postMovement(payload) { return call('postMovement', '/api/movements', 'POST', payload, [payload]); },
    async movements(filters) {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(filters || {})) if (value !== undefined && value !== null && value !== '') params.set(key, value);
      return call('movements', '/api/movements' + (params.toString() ? '?' + params : ''), 'GET', undefined, [filters || {}]);
    },
    async listMovements(filters) { return api.movements(filters); },
    async reconcile() { return call('reconcile', '/api/reconciliation', 'GET', undefined, []); },
    async resetDemo() { return call('resetDemo', '/api/demo/reset', 'POST', { confirm: 'RESET_DEMO' }, []); },
    async setupStatus() { await init(); if(selectedMode !== 'server') return {needs_setup:false,configured:false}; return request('/api/setup/status'); },
    async setupAdmin(payload) { await init(); if(selectedMode !== 'server') throw error('CLOUD_ONLY','此操作需要云端服务器。'); return request('/api/setup/admin','POST',payload); },
    async createUser(payload) { await init(); if(selectedMode !== 'server') throw error('CLOUD_ONLY','成员管理仅适用于云端网站。'); return request('/api/users','POST',payload); },
    async updateUser(id,payload) { await init(); if(selectedMode !== 'server') throw error('CLOUD_ONLY','成员管理仅适用于云端网站。'); return request('/api/users/'+encodeURIComponent(id),'PATCH',payload); },
    async resetUserPassword(id,password) { await init(); if(selectedMode !== 'server') throw error('CLOUD_ONLY','成员管理仅适用于云端网站。'); return request('/api/users/'+encodeURIComponent(id)+'/password','POST',{password}); },
    async changePassword(current_password,new_password) { await init(); if(selectedMode !== 'server') throw error('CLOUD_ONLY','请在云端网站修改密码。'); return request('/api/account/password','POST',{current_password,new_password}); }
  };
  return Object.freeze(api);
});
