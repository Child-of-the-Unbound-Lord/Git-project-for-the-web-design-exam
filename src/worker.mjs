import { SCHEMA_BASE, SCHEMA_CHECK_TRIGGER, SCHEMA_APPLY_TRIGGER } from './schema.mjs';

const COOKIE = 'labflow_session';
const SESSION_SECONDS = 12 * 3600;
const MAX_QTY = 1_000_000_000;
const PBKDF2_ITERATIONS = 260000;
let schemaReady = null;

class AppError extends Error {
  constructor(code, message, status=400) { super(message); this.code=code; this.status=status; }
}
const err = (code,message,status=400) => { throw new AppError(code,message,status); };
function reply(data,status=200,headers={}) {
  return new Response(JSON.stringify({ok:true,data}), {status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',...headers}});
}
function fault(e) {
  const status = e instanceof AppError ? e.status : 500;
  if (!(e instanceof AppError)) console.error('LabFlow Worker error',e && e.message || e);
  return new Response(JSON.stringify({ok:false,error:{code:e instanceof AppError?e.code:'SERVER_ERROR',message:e instanceof AppError?e.message:'服务器处理请求失败，请联系管理员。'}}),
    {status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
}
function isObject(o) {return !!o && typeof o==='object' && !Array.isArray(o);}
function validateFields(p,permitted,required=[]) {
  if (!isObject(p)) err('INVALID_JSON','请求必须为JSON对象。');
  if (Object.keys(p).some(x=>!permitted.includes(x))) err('UNSUPPORTED_FIELD','包含不允许的字段。');
  if (required.some(x=>!Object.prototype.hasOwnProperty.call(p,x))) err('MISSING_FIELD','缺少必填字段。');
}
function txt(v,label,max=200,required=false){
  if (typeof v !== 'string') err('VALIDATION_ERROR',label+'必须是文字。');
  const s=v.trim(); if ((required&&!s)||s.length>max||s.includes('\0'))err('VALIDATION_ERROR',label+'不符合长度或格式要求。');return s;
}
function qty(v,label,min=0) {
  if (typeof v!=='number'||!Number.isSafeInteger(v)||v<min||v>MAX_QTY) err('INVALID_QUANTITY',label+'必须为'+min+'至10亿之间的整数。');return v;
}
function bool(v,label){if(typeof v!=='boolean')err('VALIDATION_ERROR',label+'必须为布尔值。');return v?1:0;}
function passwordRules(v){if(typeof v!=='string'||v.length<12||v.length>128||v.trim()!==v)err('WEAK_PASSWORD','密码必须为12至128个字符且首尾没有空格。');return v;}
const hex = bytes => Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
const unhex = s => Uint8Array.from(s.match(/.{1,2}/g)||[],x=>parseInt(x,16));
async function sha(s){return hex(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))));}
async function pbkdf2(password,saltHex,iterations=PBKDF2_ITERATIONS) {
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);
  const derived=await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:unhex(saltHex),iterations},key,256);
  return hex(new Uint8Array(derived));
}
async function hashPassword(p){const salt=hex(crypto.getRandomValues(new Uint8Array(16)));return `pbkdf2_sha256$${PBKDF2_ITERATIONS}$${salt}$${await pbkdf2(p,salt)}`;}
function secureEquals(a,b){if(typeof a!=='string'||typeof b!=='string')return false; let x=a.length^b.length;for(let i=0;i<Math.max(a.length,b.length);i++)x|=(a.charCodeAt(i)||0)^(b.charCodeAt(i)||0);return x===0;}
async function verifyPassword(p,encoded){const m=/^pbkdf2_sha256\$(\d+)\$([0-9a-f]{32})\$([0-9a-f]{64})$/.exec(encoded||'');if(!m)return false;const i=Number(m[1]); if(i<100000||i>1000000)return false;return secureEquals(await pbkdf2(p,m[2],i),m[3]);}
function cookie(req){const found=(req.headers.get('cookie')||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(COOKIE+'='));return found?found.slice(COOKIE.length+1):'';}
function cookieHeader(value,maxAge){return `${COOKIE}=${value}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${maxAge}`;}
function publicUser(u){return {id:u.id,username:u.username,display_name:u.display_name,role:u.role,active:!!u.active};}
const publicItem = u => ({...u,active:!!u.active});
async function init(env) {
  if (!env.DB || typeof env.DB.prepare !== 'function') err('DATABASE_NOT_BOUND','尚未连接云端数据库，请检查 Cloudflare D1 绑定。',503);
  if (!schemaReady) schemaReady=(async()=>{
    await env.DB.exec(SCHEMA_BASE);
    await env.DB.exec(SCHEMA_CHECK_TRIGGER);
    await env.DB.exec(SCHEMA_APPLY_TRIGGER);
  })().catch(e=>{schemaReady=null;throw e;});
  await schemaReady;
}
async function readBody(req){const length=Number(req.headers.get('content-length')||0);if(length>65536)err('BODY_TOO_LARGE','提交内容过长。',413);let s=await req.text();if(s.length>65536)err('BODY_TOO_LARGE','提交内容过长。',413);try{return JSON.parse(s)}catch{err('INVALID_JSON','请求内容不是JSON。')}}
function checkOrigin(req){
  if(['POST','PUT','PATCH','DELETE'].includes(req.method)) {
    const origin=req.headers.get('Origin');
    if (origin&&origin!==new URL(req.url).origin) err('FORBIDDEN_ORIGIN','禁止跨站提交。',403);
    const site=req.headers.get('Sec-Fetch-Site');
    if(site&&site!=='same-origin'&&site!=='none')err('FORBIDDEN_ORIGIN','禁止跨站提交。',403);
    if((req.headers.get('content-type')||'').split(';')[0].trim()!=='application/json') err('INVALID_CONTENT_TYPE','仅接受JSON请求。',415);
  }
}
async function sessionUser(req,env){
  const token=cookie(req); if(!/^[0-9a-f]{64}$/.test(token))return null;
  const now=Math.floor(Date.now()/1000);
  const u=await env.DB.prepare('SELECT users.* FROM sessions JOIN users ON users.id=sessions.user_id WHERE sessions.token_hash=? AND sessions.expires_at>? AND users.active=1')
    .bind(await sha(token),now).first();
  return u||null;
}
async function requireUser(req,env,admin=false){const u=await sessionUser(req,env);if(!u)err('UNAUTHENTICATED','登录已失效，请重新登录。',401);if(admin&&u.role!=='admin')err('FORBIDDEN','该操作需要管理员权限。',403);return u;}
async function newSession(env,userId){const token=hex(crypto.getRandomValues(new Uint8Array(32)));const expires=Math.floor(Date.now()/1000)+SESSION_SECONDS;
  await env.DB.prepare('INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,?,?)').bind(await sha(token),userId,expires).run();return token;}
function sqlError(e){const message=String(e&&e.message||'');if(message.includes('UNIQUE constraint failed'))err('CONFLICT','数据已存在或业务编号重复。',409);
  if(message.includes('INSUFFICIENT_STOCK'))err('INSUFFICIENT_STOCK','当前库存不足。',409);
  if(message.includes('ITEM_INACTIVE'))err('ITEM_INACTIVE','耗材已停用。',409);
  if(message.includes('INVALID_RECIPIENT'))err('INVALID_RECIPIENT','领用人必须是启用的普通成员。',400);
  if(message.includes('ITEM_NOT_FOUND')||message.includes('FOREIGN KEY constraint failed'))err('NOT_FOUND','耗材或关联账号不存在。',404);
  if(message.includes('STOCK_LIMIT'))err('STOCK_LIMIT','入库数量超出库存允许上限。',409);
  if(message.includes('CHECK constraint failed'))err('VALIDATION_ERROR','数据未通过完整性约束。',400);
  throw e;
}
async function users(env){return (await env.DB.prepare('SELECT id,username,display_name,role,active FROM users ORDER BY username').all()).results.map(publicUser);}
async function items(env){return (await env.DB.prepare('SELECT * FROM items ORDER BY code').all()).results.map(publicItem);}
async function movements(env,u,filter={}){
  const all=(await env.DB.prepare('SELECT * FROM movements ORDER BY created_at DESC, id DESC').all()).results;
  if(filter.recipient_id&&u.role!=='admin'&&filter.recipient_id!==u.id)err('FORBIDDEN','只能查看本人的领用记录。',403);
  if(filter.type&&!['IN','OUT'].includes(filter.type))err('VALIDATION_ERROR','无效的业务类型。');
  for(const name of ['start','end']){if(filter[name]&&!/^\d{4}-\d{2}-\d{2}$/.test(filter[name]))err('VALIDATION_ERROR','日期格式不正确。');}
  if(filter.start&&filter.end&&filter.start>filter.end)err('VALIDATION_ERROR','开始日期不能晚于结束日期。');
  return all.filter(m=>{
    if(u.role!=='admin'&&(m.type!=='OUT'||m.recipient_id!==u.id))return false;
    if(filter.item_id&&m.item_id!==filter.item_id)return false;
    if(filter.type&&m.type!==filter.type)return false;
    if(filter.recipient_id&&m.recipient_id!==filter.recipient_id)return false;
    if(filter.start||filter.end){const date=new Date(new Date(m.created_at).getTime()+8*3600000).toISOString().slice(0,10);if(filter.start&&date<filter.start)return false;if(filter.end&&date>filter.end)return false;}
    return true;
  });
}
async function accountCount(env){const o=await env.DB.prepare("SELECT COUNT(*) n FROM users WHERE role='admin' AND active=1").first();return o.n;}
async function setupAdmin(req,env){
  if(await accountCount(env))err('ALREADY_INITIALIZED','管理员已经创建，不能重复初始化。',409);
  if(!env.ADMIN_SETUP_TOKEN||env.ADMIN_SETUP_TOKEN.length<24)err('SETUP_TOKEN_MISSING','请先在 Cloudflare Worker 中设置 ADMIN_SETUP_TOKEN 加密变量（至少24字符）。',503);
  const p=await readBody(req);validateFields(p,['setup_token','username','display_name','password'],['setup_token','username','display_name','password']);
  if(!secureEquals(p.setup_token,env.ADMIN_SETUP_TOKEN))err('INVALID_SETUP_TOKEN','初始化凭证不正确。',403);
  const username=txt(p.username,'管理员账号',64,true);
  if(!/^[a-zA-Z0-9._-]{3,64}$/.test(username)) err('VALIDATION_ERROR','管理员账号只能为3至64位字母、数字、点、横线或下划线。');
  const name=txt(p.display_name,'显示名称',120,true);
  const password=await hashPassword(passwordRules(p.password));
  let setup;
  try{setup=await env.DB.prepare('INSERT INTO users (id,username,display_name,role,password_hash,active,created_at) SELECT ?,?,?,?,?,1,? WHERE NOT EXISTS (SELECT 1 FROM users WHERE role=\'admin\' AND active=1)')
    .bind(crypto.randomUUID(),username,name,'admin',password,new Date().toISOString()).run();}
  catch(e){sqlError(e);}
  if(!setup?.meta?.changes)err('SETUP_RACE','管理员已被其他请求初始化，请刷新。',409);
  return reply({created:true});
}
async function login(req,env){const p=await readBody(req);validateFields(p,['username','password'],['username','password']);
  const name=txt(p.username,'用户名',64,true); const pass=p.password;
  if(typeof pass!=='string'||pass.length>128)err('INVALID_CREDENTIALS','账号或密码错误。',401);
  const address=req.headers.get('CF-Connecting-IP')||'unknown';const key=await sha(name.toLowerCase()+':'+address);
  const t=await env.DB.prepare('SELECT failures,locked_until FROM login_throttle WHERE throttle_key=?').bind(key).first();
  const now=Math.floor(Date.now()/1000);
  if(t&&t.locked_until>now)err('RATE_LIMIT','登录尝试过多，请稍后再试。',429);
  const u=await env.DB.prepare('SELECT * FROM users WHERE username=? AND active=1').bind(name).first();
  const ok=await verifyPassword(pass,u?u.password_hash:'pbkdf2_sha256$260000$00000000000000000000000000000000$0000000000000000000000000000000000000000000000000000000000000000');
  if(!u||!ok){await env.DB.prepare(`INSERT INTO login_throttle (throttle_key,failures,window_started_at,locked_until) VALUES (?,1,?,0)
     ON CONFLICT(throttle_key) DO UPDATE SET
     failures=CASE WHEN login_throttle.window_started_at<? THEN 1 ELSE login_throttle.failures+1 END,
     locked_until=CASE WHEN login_throttle.window_started_at>=? AND login_throttle.failures>=4 THEN ? ELSE 0 END,
     window_started_at=CASE WHEN login_throttle.window_started_at<? THEN ? ELSE login_throttle.window_started_at END`)
    .bind(key,now,now-900,now-900,now+900,now-900,now).run();err('INVALID_CREDENTIALS','账号或密码错误。',401);}
  await env.DB.prepare('DELETE FROM login_throttle WHERE throttle_key=?').bind(key).run();
  const token=await newSession(env,u.id);
  return reply({user:publicUser(u),mode:'server',cloud:true},200,{'Set-Cookie':cookieHeader(token,SESSION_SECONDS)});
}
async function manageUser(req,env,u,path){
  const id=path.match(/^\/api\/users\/([^/]+)(?:\/(password))?$/)?.[1];
  if(req.method==='GET'&&path==='/api/users')return reply({users:await users(env)});
  if(req.method==='POST'&&path==='/api/users'){
    const p=await readBody(req);validateFields(p,['username','display_name','role','password'],['username','display_name','role','password']);
    const name=txt(p.username,'用户名',64,true);const display=txt(p.display_name,'显示名称',120,true);
    if(!/^[a-zA-Z0-9._-]{3,64}$/.test(name))err('VALIDATION_ERROR','用户名只能使用3至64位字母、数字、点、横线或下划线。');
    if(!['admin','member'].includes(p.role))err('VALIDATION_ERROR','无效的账号角色。');
    const hash=await hashPassword(passwordRules(p.password));const userId=crypto.randomUUID();
    try{await env.DB.prepare('INSERT INTO users (id,username,display_name,role,password_hash,active,created_at) VALUES (?,?,?,?,?,1,?)')
      .bind(userId,name,display,p.role,hash,new Date().toISOString()).run();}catch(e){sqlError(e);}
    return reply({user:{id:userId,username:name,display_name:display,role:p.role,active:true}},201);
  }
  if(!id)err('NOT_FOUND','未找到接口。',404);
  const old=await env.DB.prepare('SELECT * FROM users WHERE id=?').bind(id).first();if(!old)err('NOT_FOUND','成员不存在。',404);
  if(req.method==='POST'&&path.endsWith('/password')){
    const p=await readBody(req);validateFields(p,['password'],['password']);const hashed=await hashPassword(passwordRules(p.password));
    await env.DB.prepare('UPDATE users SET password_hash=? WHERE id=?').bind(hashed,id).run();
    await env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(id).run();
    return reply({updated:true,sessions_revoked:true});
  }
  if(req.method==='PATCH'&&path==='/api/users/'+id){
    const p=await readBody(req);validateFields(p,['display_name','role','active']);
    const name=p.display_name===undefined?old.display_name:txt(p.display_name,'显示名称',120,true);
    const role=p.role===undefined?old.role:p.role;
    if(!['admin','member'].includes(role))err('VALIDATION_ERROR','角色只能是管理员或成员。');
    const active=p.active===undefined?old.active:bool(p.active,'启用状态');
    if(id===u.id&&(active!==1||role!=='admin'))err('SELF_ROLE_CHANGE','不能停用自己或撤销自己的管理员角色。',409);
    if(old.role==='admin'&&old.active===1&&(role!=='admin'||active!==1)&&await accountCount(env)<=1)err('LAST_ADMIN','必须至少保留一个启用的管理员。',409);
    await env.DB.prepare('UPDATE users SET display_name=?,role=?,active=? WHERE id=?').bind(name,role,active,id).run();
    if(active!==old.active||role!==old.role) await env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(id).run();
    return reply({user:{id,username:old.username,display_name:name,role,active:!!active}});
  }
  err('NOT_FOUND','未找到接口。',404);
}
async function createItem(req,env){const p=await readBody(req);validateFields(p,['code','name','spec','unit','location','min_stock','active'],['code','name','unit']);
  const id=crypto.randomUUID();const code=txt(p.code,'耗材编码',64,true);const name=txt(p.name,'耗材名称',120,true);
  const spec=txt(p.spec??'','规格',200);const unit=txt(p.unit,'单位',30,true);const location=txt(p.location??'','位置',200);
  const min=qty(p.min_stock??0,'库存下限');const active=p.active===undefined?1:bool(p.active,'状态');
  try{await env.DB.prepare('INSERT INTO items (id,code,name,spec,unit,location,min_stock,current_stock,active) VALUES (?,?,?,?,?,?,?,0,?)')
    .bind(id,code,name,spec,unit,location,min,active).run();}catch(e){if(String(e.message).includes('UNIQUE'))err('DUPLICATE_CODE','耗材编码已存在。',409);sqlError(e);}
  const item=await env.DB.prepare('SELECT * FROM items WHERE id=?').bind(id).first();return reply({item:publicItem(item)},201);
}
async function updateItem(req,env,id){const p=await readBody(req);validateFields(p,['name','spec','location','min_stock','active']);
  const old=await env.DB.prepare('SELECT * FROM items WHERE id=?').bind(id).first();if(!old)err('NOT_FOUND','耗材不存在。',404);
  const name=p.name===undefined?old.name:txt(p.name,'名称',120,true);const spec=p.spec===undefined?old.spec:txt(p.spec,'规格',200);
  const location=p.location===undefined?old.location:txt(p.location,'存放位置',200);
  const min=p.min_stock===undefined?old.min_stock:qty(p.min_stock,'库存下限');const active=p.active===undefined?old.active:bool(p.active,'状态');
  await env.DB.prepare('UPDATE items SET name=?,spec=?,location=?,min_stock=?,active=? WHERE id=?').bind(name,spec,location,min,active,id).run();
  const item=await env.DB.prepare('SELECT * FROM items WHERE id=?').bind(id).first();return reply({item:publicItem(item)});
}
async function postMovement(req,env,u){const p=await readBody(req);validateFields(p,['business_no','item_id','type','quantity','recipient_id','note'],['business_no','item_id','type','quantity']);
  const business_no=txt(p.business_no,'业务单号',100,true);const item_id=txt(p.item_id,'耗材ID',100,true);
  const type=txt(p.type,'类型',3,true);if(!['IN','OUT'].includes(type))err('VALIDATION_ERROR','操作类型不正确。');
  const quantity=qty(p.quantity,'数量',1);const recipient_id=type==='OUT'?txt(p.recipient_id,'领用人',100,true):null;
  const note=txt(p.note??'','备注',500);
  const normalized={business_no,item_id,type,quantity,recipient_id,operator_id:u.id,note};
  const previous=await env.DB.prepare('SELECT * FROM movements WHERE business_no=?').bind(business_no).first();
  const same=m=>m&&Object.entries(normalized).every(([k,v])=>m[k]===v);
  if(previous){if(!same(previous))err('BUSINESS_CONFLICT','该业务单号对应另一笔操作，不能重复使用。',409);const item=await env.DB.prepare('SELECT current_stock FROM items WHERE id=?').bind(previous.item_id).first();return reply({movement:previous,idempotent:true,current_stock:item.current_stock});}
  const mid=crypto.randomUUID();const at=new Date().toISOString();
  try{await env.DB.prepare('INSERT INTO movements (id,business_no,item_id,type,quantity,recipient_id,operator_id,note,created_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .bind(mid,business_no,item_id,type,quantity,recipient_id,u.id,note,at).run();}
  catch(e){
    // Concurrent retry may have committed while this request was waiting.
    const existing=await env.DB.prepare('SELECT * FROM movements WHERE business_no=?').bind(business_no).first();
    if(existing){if(!same(existing))err('BUSINESS_CONFLICT','该业务单号对应另一笔操作。',409);
      const item=await env.DB.prepare('SELECT current_stock FROM items WHERE id=?').bind(item_id).first();return reply({movement:existing,idempotent:true,current_stock:item.current_stock});}
    sqlError(e);
  }
  const [movement,item]=await Promise.all([env.DB.prepare('SELECT * FROM movements WHERE id=?').bind(mid).first(),env.DB.prepare('SELECT current_stock FROM items WHERE id=?').bind(item_id).first()]);
  return reply({movement,idempotent:false,current_stock:item.current_stock},201);
}
async function reconcile(env){const rows=(await env.DB.prepare(`SELECT i.id item_id,i.code,i.name,i.current_stock,i.active,
   COALESCE(SUM(CASE WHEN m.type='IN' THEN m.quantity ELSE 0 END),0) inbound,
   COALESCE(SUM(CASE WHEN m.type='OUT' THEN m.quantity ELSE 0 END),0) outbound
   FROM items i LEFT JOIN movements m ON i.id=m.item_id GROUP BY i.id ORDER BY i.code`).all()).results;
  return {rows:rows.map(r=>({...r,active:!!r.active,ledger_stock:r.inbound-r.outbound,difference:r.current_stock-(r.inbound-r.outbound)})),checked_at:new Date().toISOString()};}

async function handle(req,env){
  if(!env.DB)err('DATABASE_NOT_BOUND','云端共享数据库尚未准备好。',503);
  await init(env);
  const path=new URL(req.url).pathname;
  if(req.method==='GET'&&path==='/api/health')return reply({ready:true,cloud:true});
  if(req.method==='GET'&&path==='/api/setup/status')return reply({needs_setup:(await accountCount(env))===0,configured:!!env.ADMIN_SETUP_TOKEN&&env.ADMIN_SETUP_TOKEN.length>=24});
  if(req.method==='POST'&&path==='/api/setup/admin')return setupAdmin(req,env);
  if(req.method==='GET'&&path==='/api/session'){const u=await sessionUser(req,env);return reply({user:u?publicUser(u):null,mode:'server',cloud:true});}
  if(req.method==='POST'&&path==='/api/login')return login(req,env);
  if(req.method==='POST'&&path==='/api/logout'){
    const raw=cookie(req);if(raw&&/^[0-9a-f]{64}$/.test(raw))await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await sha(raw)).run();
    return reply({user:null,mode:'server'},200,{'Set-Cookie':cookieHeader('',0)});
  }
  const adminOps=(path==='/api/items'&&req.method==='POST')||(path.startsWith('/api/items/')&&req.method==='PATCH')||(path==='/api/movements'&&req.method==='POST')||(path==='/api/reconciliation'&&req.method==='GET')||path==='/api/users'||path.startsWith('/api/users/');
  const u=await requireUser(req,env,adminOps);
  if(req.method==='GET'&&path==='/api/state'){
    const [uList,iList,mList]=await Promise.all([u.role==='admin'?users(env):[publicUser(u)],items(env),movements(env,u)]);
    return reply({user:publicUser(u),users:uList,items:iList,movements:mList,mode:'server',cloud:true});
  }
  if(req.method==='GET'&&path==='/api/items')return reply({items:await items(env)});
  if(req.method==='POST'&&path==='/api/items')return createItem(req,env);
  if(req.method==='PATCH'&&/^\/api\/items\/[^/]+$/.test(path))return updateItem(req,env,decodeURIComponent(path.slice('/api/items/'.length)));
  if(req.method==='POST'&&path==='/api/movements')return postMovement(req,env,u);
  if(req.method==='GET'&&path==='/api/movements')return reply({movements:await movements(env,u,Object.fromEntries(new URL(req.url).searchParams))});
  if(req.method==='GET'&&path==='/api/reconciliation')return reply(await reconcile(env));
  if(path==='/api/users'||path.startsWith('/api/users/'))return manageUser(req,env,u,path);
  if(req.method==='POST'&&path==='/api/account/password'){
    const p=await readBody(req);validateFields(p,['current_password','new_password'],['current_password','new_password']);
    if(!await verifyPassword(p.current_password,u.password_hash))err('INVALID_CREDENTIALS','原密码不正确。',403);
    const hashed=await hashPassword(passwordRules(p.new_password));
    await env.DB.prepare('UPDATE users SET password_hash=? WHERE id=?').bind(hashed,u.id).run();
    await env.DB.prepare('DELETE FROM sessions WHERE user_id=?').bind(u.id).run();
    return reply({changed:true,login_required:true},200,{'Set-Cookie':cookieHeader('',0)});
  }
  if(req.method==='POST'&&path==='/api/demo/reset')err('FORBIDDEN','云端正式数据不能通过演示按钮重置。',403);
  err('NOT_FOUND','未找到接口。',404);
}
export default {
  async fetch(req,env){
    const path=new URL(req.url).pathname;
    if(!path.startsWith('/api/')){
      if(env.ASSETS)return env.ASSETS.fetch(req);
      return new Response('Static assets binding missing',{status:503});
    }
    try{checkOrigin(req);return await handle(req,env);}catch(e){return fault(e);}
  }
};
