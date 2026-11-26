#!/usr/bin/env node
'use strict';
// Run: node tests/browser-domain-checks.js
// Uses isolated in-memory domain fixtures, never the user's IndexedDB data.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Domain: D, createBrowserStore } = require('../web/browser-store.js');
const { createAPI } = require('../web/api.js');
const root = path.resolve(__dirname, '..');
const demoSeed = JSON.parse(fs.readFileSync(path.join(root, 'seed.json'), 'utf8'));
const results = [];
const ADMIN = 'U_ADMIN';
const MEMBER = 'U_A';
const OTHER = 'U_B';
const AT = '2026-11-26T10:00:00.000Z';

function fixture(opening = 8, threshold = 5, active = true) {
  return D.createSeed({ users: demoSeed.users, items: [
    { id: 'T1', code: 'TEST-01', name: '测试电池', unit: '节', spec: '测试夹具', location: '测试环境', min_stock: threshold, opening_qty: opening, issued_qty: 0, active }
  ] }, AT);
}
function input(no, type = 'OUT', quantity = 3, extra) {
  return Object.assign({ business_no: no, item_id: 'T1', type, quantity, recipient_id: MEMBER, note: '测试' }, extra || {});
}
function mustReject(fn, code) {
  assert.throws(fn, e => { assert.equal(e.code, code); return true; });
}
function unchangedOnFailure(state, fn, code) {
  const before = JSON.stringify(state);
  mustReject(fn, code);
  assert.equal(JSON.stringify(state), before);
}
async function check(id, label, cases, fn) {
  const start = performance.now();
  try {
    await fn();
    results.push({ id, label, related_cases: cases, status: 'passed', duration_ms: Math.round((performance.now() - start) * 100) / 100 });
  } catch (e) {
    results.push({ id, label, related_cases: cases, status: 'failed', error: e.stack || String(e) });
  }
}
function jsonReply(data, status = 200) {
  return { status, ok: status >= 200 && status < 300, headers: { get: () => 'application/json; charset=utf-8' }, json: async () => data };
}
function apiFixture(responses, protocol = 'http:') {
  const calls = []; let fallbackCalls = 0;
  const env = {
    location: { protocol }, AbortController, setTimeout, clearTimeout,
    BrowserStore: {
      init: async () => { fallbackCalls++; return { user: null, mode: 'browser' }; },
      session: async () => ({ user: null, mode: 'browser' }),
      state: async () => ({ user: null, users: [], items: [], movements: [], mode: 'browser' })
    },
    fetch: async (url, options) => {
      calls.push({ url, options });
      const response = responses.shift();
      if (response instanceof Error) throw response;
      if (!response) throw new Error('Unexpected fetch: ' + url);
      return response;
    }
  };
  return { api: createAPI(env), calls, fallbackCalls: () => fallbackCalls };
}

(async function main() {
  await check('D01', '正常入库增加库存并留下流水', ['TC01'], () => {
    const s = fixture(0);
    const r = D.postMovement(s, ADMIN, input('IN-20', 'IN', 20), AT);
    assert.equal(r.data.current_stock, 20); assert.equal(r.state.movements.length, 1);
    assert.equal(r.data.movement.recipient_id, null); assert.equal(r.data.movement.operator_id, ADMIN);
    assert.equal(s.items[0].current_stock, 0); // Pure candidate; not a half-written input.
  });
  await check('D02', '入库与领用均拒绝0、负数、小数、字符串、布尔及非有限数', ['TC02', 'TC06'], () => {
    for (const type of ['IN', 'OUT']) for (const amount of [0, -1, 1.5, '2', true, false, null, NaN, Infinity, 1000000001]) {
      const s = fixture(); unchangedOnFailure(s, () => D.postMovement(s, ADMIN, input('INVALID', type, amount), AT), 'VALIDATION_ERROR');
    }
  });
  await check('D03', '正常领用保存领用人及经办人', ['TC03'], () => {
    const r = D.postMovement(fixture(20), ADMIN, input('OUT-7', 'OUT', 7), AT);
    assert.equal(r.data.current_stock, 13); assert.equal(r.data.movement.recipient_id, MEMBER); assert.equal(r.data.movement.operator_id, ADMIN);
  });
  await check('D04', '领用量等于库存允许归零，超过库存拒绝', ['TC04', 'TC05'], () => {
    assert.equal(D.postMovement(fixture(), ADMIN, input('EXACT', 'OUT', 8), AT).data.current_stock, 0);
    const s = fixture(); unchangedOnFailure(s, () => D.postMovement(s, ADMIN, input('OVER', 'OUT', 9), AT), 'INSUFFICIENT_STOCK');
  });
  await check('D05', '相同单号规范化重试仅一条记录并返回最新库存', ['TC07'], () => {
    const first = D.postMovement(fixture(10), ADMIN, input(' B001 ', 'OUT', 3, { note: ' 测试 ' }), AT);
    const later = D.postMovement(first.state, ADMIN, input('B002', 'IN', 2), AT);
    const retry = D.postMovement(later.state, ADMIN, input('B001', 'OUT', 3), AT);
    assert.equal(retry.data.idempotent, true); assert.equal(retry.data.movement.id, first.data.movement.id);
    assert.equal(retry.data.current_stock, 9); assert.equal(retry.state.movements.filter(m => m.business_no === 'B001').length, 1);
  });
  await check('D06', '单号冲突覆盖数量、备注、领用人和经办人变化', ['TC08'], () => {
    const state = D.postMovement(fixture(10), ADMIN, input('B001'), AT).state;
    for (const patch of [{ quantity: 4 }, { note: '不同备注' }, { recipient_id: OTHER }]) {
      unchangedOnFailure(state, () => D.postMovement(state, ADMIN, input('B001', 'OUT', 3, patch), AT), 'BUSINESS_NO_CONFLICT');
    }
    const withAdmin = JSON.parse(JSON.stringify(state));
    withAdmin.users.push({ id: 'U_ADMIN_2', username: 'test_admin', display_name: '测试管理员', role: 'admin' });
    mustReject(() => D.postMovement(withAdmin, 'U_ADMIN_2', input('B001'), AT), 'BUSINESS_NO_CONFLICT');
  });
  await check('D07', '普通成员与未登录者无法写入或借幂等重试越权', ['TC09'], () => {
    const s = D.postMovement(fixture(10), ADMIN, input('B001'), AT).state;
    unchangedOnFailure(s, () => D.postMovement(s, MEMBER, input('B001'), AT), 'FORBIDDEN');
    mustReject(() => D.postMovement(s, MEMBER, input('B002', 'IN', 1), AT), 'FORBIDDEN');
    mustReject(() => D.postMovement(s, null, input('B002'), AT), 'AUTH_REQUIRED');
    mustReject(() => D.createItem(s, MEMBER, { code: 'X', name: 'X', unit: '件' }), 'FORBIDDEN');
  });
  await check('D08', '成员只获得本人身份与本人OUT记录，显式查他人返回403', ['TC10'], () => {
    let s = fixture(20);
    s = D.postMovement(s, ADMIN, input('A-OUT'), AT).state;
    s = D.postMovement(s, ADMIN, input('B-OUT', 'OUT', 2, { recipient_id: OTHER }), AT).state;
    const view = D.viewState(s, MEMBER);
    assert.deepEqual(view.users.map(u => u.id), [MEMBER]);
    assert.equal(view.items.length, s.items.length);
    assert.deepEqual(view.movements.map(m => m.business_no), ['A-OUT']);
    assert.equal(D.movements(s, MEMBER, { recipient_id: MEMBER }).movements.length, 1);
    mustReject(() => D.movements(s, MEMBER, { recipient_id: OTHER }), 'FORBIDDEN');
    mustReject(() => D.movements(s, MEMBER, { recipient_id: 'NONEXISTENT' }), 'FORBIDDEN');
    assert.equal(D.movements(s, MEMBER, { type: 'IN' }).movements.length, 0);
  });
  await check('D09', '查询匹配项与空结果且返回副本不能修改存储', ['TC11'], () => {
    const s = fixture(); const view = D.viewState(s, MEMBER);
    assert.equal(view.items.filter(i => i.code === 'TEST-01').length, 1);
    assert.equal(view.items.filter(i => i.code === 'NO-SUCH-CODE').length, 0);
    assert.deepEqual(D.movements(s, ADMIN, { item_id: 'NO-SUCH-ID' }).movements, []);
    view.items[0].current_stock = 99; assert.equal(s.items[0].current_stock, 8);
  });
  await check('D10', '20加10减7的全部历史与库存同时为23', ['TC12'], () => {
    let s = fixture(0);
    for (const p of [input('A', 'IN', 20), input('B', 'IN', 10), input('C', 'OUT', 7)]) s = D.postMovement(s, ADMIN, p, AT).state;
    const r = D.reconcile(s, ADMIN, AT).rows[0];
    assert.equal(r.inbound, 30); assert.equal(r.outbound, 7); assert.equal(r.ledger_stock, 23); assert.equal(r.current_stock, 23); assert.equal(r.difference, 0);
  });
  await check('D11', '预警覆盖低于、等于、高于下限', ['TC13', 'TC14', 'TC15'], () => {
    assert.equal(D.alerts(fixture(4, 5), ADMIN).length, 1);
    assert.equal(D.alerts(fixture(5, 5), ADMIN).length, 1);
    assert.equal(D.alerts(fixture(6, 5), ADMIN).length, 0);
  });
  await check('D12', '下限调整立即改变预警，非法下限不写入', ['TC16'], () => {
    const s = fixture(6, 5);
    const changed = D.updateItem(s, ADMIN, 'T1', { min_stock: 6 }).state;
    assert.equal(D.alerts(changed, ADMIN).length, 1);
    for (const n of [-1, 1.5, true, '6', 1000000001]) unchangedOnFailure(s, () => D.updateItem(s, ADMIN, 'T1', { min_stock: n }), 'VALIDATION_ERROR');
  });
  await check('D13', '领域候选状态与原状态隔离，拒绝的操作不产生半成品', ['TC17 (domain scope only)'], () => {
    const s = fixture(); const original = JSON.stringify(s);
    const candidate = D.postMovement(s, ADMIN, input('CANDIDATE'), AT);
    assert.equal(candidate.state.items[0].current_stock, 5);
    assert.equal(JSON.stringify(s), original);
    unchangedOnFailure(s, () => D.postMovement(s, ADMIN, input('BAD-RECIPIENT', 'OUT', 1, { recipient_id: ADMIN }), AT), 'INVALID_RECIPIENT');
  });
  await check('D14', '补货解除预警且保留入库流水', ['TC18'], () => {
    const s = D.postMovement(fixture(4, 5), ADMIN, input('RESTOCK', 'IN', 2), AT).state;
    assert.equal(D.alerts(s, ADMIN).length, 0); assert.equal(s.movements.at(-1).type, 'IN');
  });
  await check('D15', '档案零库存、唯一编码和必填校验', ['TC19'], () => {
    const s = fixture(); const payload = { code: 'C001', name: '电池', unit: '节', min_stock: 0 };
    const added = D.createItem(s, ADMIN, payload);
    assert.equal(added.data.item.current_stock, 0); assert.equal(added.data.item.min_stock, 0);
    mustReject(() => D.createItem(added.state, ADMIN, payload), 'DUPLICATE_CODE');
    for (const key of ['code', 'name', 'unit']) mustReject(() => D.createItem(s, ADMIN, Object.assign({}, payload, { [key]: ' ' })), 'VALIDATION_ERROR');
    assert.equal(D.createItem(added.state, ADMIN, Object.assign({}, payload, { code: 'C002' })).data.item.name, '电池');
  });
  await check('D16', '成员修改下限被拒绝', ['TC20'], () => {
    const s = fixture(); unchangedOnFailure(s, () => D.updateItem(s, MEMBER, 'T1', { min_stock: 6 }), 'FORBIDDEN');
  });
  await check('D17', '停用不预警且拒绝新出入库，启用后恢复，历史保留', ['TC21'], () => {
    const s = fixture(4, 5, false); const count = s.movements.length;
    assert.equal(D.alerts(s, ADMIN).length, 0);
    for (const type of ['IN', 'OUT']) unchangedOnFailure(s, () => D.postMovement(s, ADMIN, input('INACTIVE', type, 1), AT), 'ITEM_INACTIVE');
    const active = D.updateItem(s, ADMIN, 'T1', { active: true }).state;
    assert.equal(D.alerts(active, ADMIN).length, 1); assert.equal(active.movements.length, count);
  });
  await check('D18', '停用后的相同单号重试仍成功，新单号被拒绝', ['TC07', 'TC21'], () => {
    const first = D.postMovement(fixture(), ADMIN, input('DONE'), AT);
    const disabled = D.updateItem(first.state, ADMIN, 'T1', { active: false }).state;
    assert.equal(D.postMovement(disabled, ADMIN, input('DONE'), AT).data.idempotent, true);
    mustReject(() => D.postMovement(disabled, ADMIN, input('NEW'), AT), 'ITEM_INACTIVE');
  });
  await check('D19', '隔离的损坏夹具显示差额2，核对使用全历史且不自动纠正', ['TC22'], () => {
    const s = fixture(8); s.items[0].current_stock = 10;
    const before = JSON.stringify(s);
    assert.equal(D.movements(s, ADMIN, { start: '2099-01-01' }).movements.length, 0);
    const row = D.reconcile(s, ADMIN, AT).rows[0];
    assert.equal(row.inbound, 8); assert.equal(row.ledger_stock, 8); assert.equal(row.difference, 2);
    assert.equal(JSON.stringify(s), before);
    mustReject(() => D.reconcile(s, MEMBER, AT), 'FORBIDDEN');
  });
  await check('D20', '下限0仍在库存0时预警', ['BR05', 'BR09'], () => {
    assert.equal(D.alerts(fixture(0, 0), MEMBER).length, 1);
    assert.equal(D.alerts(fixture(1, 0), MEMBER).length, 0);
  });
  await check('D21', '固定单位、编码、直接写库存和伪造经办人均拒绝', ['BR03', 'BR06'], () => {
    const s = fixture();
    for (const patch of [{ code: 'CHANGED' }, { unit: '盒' }, { current_stock: 99 }, { active: 'false' }]) mustReject(() => D.updateItem(s, ADMIN, 'T1', patch), 'VALIDATION_ERROR');
    mustReject(() => D.createItem(s, ADMIN, { code: 'C', name: 'C', unit: '件', current_stock: 5 }), 'VALIDATION_ERROR');
    mustReject(() => D.postMovement(s, ADMIN, input('SPOOF', 'OUT', 1, { operator_id: OTHER }), AT), 'VALIDATION_ERROR');
  });
  await check('D22', '入库上限1e9及超限检查，IN领用人规范化为空', ['BR01', 'BR04'], () => {
    const r = D.postMovement(fixture(0), ADMIN, input('MAX', 'IN', 1e9, { recipient_id: 'ANY-IGNORED' }), AT);
    assert.equal(r.data.current_stock, 1e9); assert.equal(r.data.movement.recipient_id, null);
    unchangedOnFailure(r.state, () => D.postMovement(r.state, ADMIN, input('OVERMAX', 'IN', 1), AT), 'STOCK_LIMIT');
    assert.equal(D.postMovement(r.state, ADMIN, input('MAX', 'IN', 1e9, { recipient_id: MEMBER }), AT).data.idempotent, true);
  });
  await check('D23', '日期过滤采用中国时区且拒绝无效日期和反向区间', ['BR08'], () => {
    let s = fixture(0);
    s = D.postMovement(s, ADMIN, input('UTC-LATE', 'IN', 2), '2026-11-01T16:30:00Z').state;
    assert.equal(D.movements(s, ADMIN, { start: '2026-11-02', end: '2026-11-02' }).movements.length, 1);
    assert.equal(D.movements(s, ADMIN, { end: '2026-11-01' }).movements.length, 0);
    for (const filters of [{ start: '2026-02-30' }, { start: '2026-11-03', end: '2026-11-02' }]) mustReject(() => D.movements(s, ADMIN, filters), 'VALIDATION_ERROR');
  });
  await check('D24', '示例种子12档案、真实期初与领用记录，逐项核对相符', ['BR08'], () => {
    const s = D.createSeed(demoSeed, AT);
    assert.equal(s.items.length, 12); assert.equal(s.users.length, 3);
    assert.equal(s.movements.length, 22);
    assert.ok(D.reconcile(s, ADMIN, AT).rows.every(r => r.difference === 0));
    assert.deepEqual(D.alerts(s, ADMIN).map(i => i.id), ['I002', 'I004', 'I007', 'I012']);
  });
  await check('D25', '仅示例凭据可登录，用户和持久化状态不带密码字段', ['BR06'], () => {
    const seed = JSON.parse(JSON.stringify(demoSeed)); seed.users[0].password = 'SECRET_MUST_NOT_PERSIST';
    const s = D.createSeed(seed, AT);
    assert.equal(D.login(s, 'admin', 'Admin123!').id, ADMIN);
    assert.equal(D.login(s, 'member_a', 'Member123!').role, 'member');
    mustReject(() => D.login(s, 'admin', 'bad'), 'INVALID_CREDENTIALS');
    assert.ok(!JSON.stringify(s).includes('SECRET_MUST_NOT_PERSIST'));
    assert.ok(!JSON.stringify(s).includes('Admin123!'));
    assert.ok(!Object.prototype.hasOwnProperty.call(D.login(s, 'admin', 'Admin123!'), 'password'));
  });

  await check('A01', 'file协议直接选择浏览器演示且不探测服务器', [], async () => {
    const f = apiFixture([], 'file:'); await f.api.init();
    assert.equal(f.api.mode, 'browser'); assert.equal(f.calls.length, 0); assert.equal(f.fallbackCalls(), 1);
    assert.equal((await f.api.session()).mode, 'browser');
  });
  await check('A02', '非API的HTML页面、404和初次网络不可达可选择浏览器演示', [], async () => {
    for (const response of [{ status: 200, ok: true, headers: { get: () => 'text/html' } }, jsonReply({ ok: false, error: { code: 'NOT_FOUND' } }, 404), new Error('unreachable')]) {
      const f = apiFixture([response]); await f.api.init(); assert.equal(f.api.mode, 'browser'); assert.equal(f.fallbackCalls(), 1);
    }
  });
  await check('A03', '首次真实JSON API错误不降级到另一份浏览器数据', [], async () => {
    const f = apiFixture([jsonReply({ ok: false, error: { code: 'AUTH_REQUIRED', message: '请登录' } }, 401)]);
    await assert.rejects(f.api.init(), e => e.code === 'AUTH_REQUIRED');
    assert.equal(f.api.mode, 'server'); assert.equal(f.fallbackCalls(), 0);
  });
  await check('A04', '建立server模式后HTTP错误与断网均保留server模式', [], async () => {
    const f = apiFixture([jsonReply({ ok: true, data: { user: null } }), jsonReply({ ok: false, error: { code: 'DATABASE_ERROR', message: '测试错误' } }, 500), new Error('offline')]);
    await f.api.init();
    await assert.rejects(f.api.state(), e => e.code === 'DATABASE_ERROR');
    await assert.rejects(f.api.state(), e => e.code === 'NETWORK_ERROR');
    assert.equal(f.api.mode, 'server'); assert.equal(f.fallbackCalls(), 0);
  });
  await check('A05', '服务器调用使用同源cookie且重置带显式确认常量', [], async () => {
    const f = apiFixture([jsonReply({ ok: true, data: { user: null } }), jsonReply({ ok: true, data: { reset: true } })]);
    await f.api.init(); assert.deepEqual(await f.api.resetDemo(), { reset: true });
    assert.equal(f.calls[1].url, '/api/demo/reset'); assert.equal(f.calls[1].options.credentials, 'same-origin');
    assert.deepEqual(JSON.parse(f.calls[1].options.body), { confirm: 'RESET_DEMO' });
  });
  await check('A06', 'IndexedDB不可用时清楚报错，不伪装为内存持久化', [], async () => {
    const store = createBrowserStore({ LabSeed: demoSeed });
    await assert.rejects(store.init(), e => e.code === 'STORAGE_UNAVAILABLE' && e.message.includes('本地 Python'));
  });
  await check('A07', '浏览器公开接口没有篡改存储或注入失败入口', [], () => {
    const store = createBrowserStore({});
    assert.deepEqual(Object.keys(store).sort(), ['mode', 'init', 'session', 'login', 'logout', 'state', 'createItem', 'updateItem', 'postMovement', 'movements', 'listMovements', 'reconcile', 'resetDemo'].sort());
    assert.equal(Object.isFrozen(store), true);
  });

  const report = {
    title: '浏览器演示领域规则与适配器自动检查',
    executed_at: new Date().toISOString(),
    command: 'node tests/browser-domain-checks.js',
    environment: { node: process.version, platform: process.platform },
    data_scope: '全部检查使用独立程序夹具与请求替身，未读取、修改或伪造真实问卷和用户验收数据。',
    limitations: [
      '本文件覆盖纯领域规则与模式选择，不等同于浏览器IndexedDB实际持久化、跨标签事务或界面验收。',
      'D13只证明领域候选状态隔离与失败时输入不变；TC17实际提交失败回滚仍应以服务端事务测试及浏览器集成检查为依据。',
      '浏览器账号和权限仅模拟角色；本地Python版提供服务端认证与授权。'
    ],
    total: results.length,
    passed: results.filter(r => r.status === 'passed').length,
    failed: results.filter(r => r.status === 'failed').length,
    results
  };
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
  const out = path.join(root, 'docs/browser-domain-results.json');
  fs.writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ total: report.total, passed: report.passed, failed: report.failed, report: out }, null, 2));
  if (report.failed) { for (const r of results.filter(r => r.status === 'failed')) console.error(r.id, r.error); process.exitCode = 1; }
})();
