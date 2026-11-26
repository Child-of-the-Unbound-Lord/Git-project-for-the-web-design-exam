import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import worker from '../src/worker.mjs';
const db = new DatabaseSync(':memory:');
db.exec('PRAGMA foreign_keys=ON;');
const counts = [];
const DB = {
  async exec(sql) { db.exec(sql); return {count:sql.split(';').length}; },
  prepare(sql) {
    let bindings=[];
    return {
      bind(...args) { bindings=args; return this; },
      async first() { return db.prepare(sql).get(...bindings)||null; },
      async all() { return {results:db.prepare(sql).all(...bindings)}; },
      async run() { const res=db.prepare(sql).run(...bindings); return {success:true,meta:{changes:Number(res.changes)}}; }
    };
  }
};
const env={DB,ADMIN_SETUP_TOKEN:'TEST-ONLY-setup-token-please-keep-secret-12345',ASSETS:{fetch:async()=>new Response('Demo HTML',{headers:{'content-type':'text/html'}})}};
const origin='https://example.workers.dev';
async function send(method,path,body,session,overrideOrigin=origin){
 const headers={};if(body!==undefined){headers['Content-Type']='application/json';headers.Origin=overrideOrigin;}
 if(session) headers.Cookie='labflow_session='+session;
 const req=new Request(origin+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
 const res=await worker.fetch(req,env), j=await res.json();
 return {status:res.status,body:j,cookie:res.headers.get('set-cookie')||''};
}
async function test(name,fn){try{await fn();counts.push([name,'PASS']);console.log('PASS',name);}catch(e){counts.push([name,'FAIL']);console.error('FAIL',name,e.stack||e);}}
function cookie(r){return /labflow_session=([0-9a-f]{64})/.exec(r.cookie)?.[1];}
let admin='',a='',b='',itemId='';
await test('首次进入没有默认管理员，需显式设置',async()=>{const r=await send('GET','/api/setup/status');assert.equal(r.status,200);assert.equal(r.body.data.needs_setup,true);});
await test('初始化密钥不正确被拒绝',async()=>{const r=await send('POST','/api/setup/admin',{username:'owner',display_name:'管理员',password:'Secure-test-pass-1234',setup_token:'bad'});assert.equal(r.status,403);});
await test('创建真正管理员，重复初始化被拒绝',async()=>{const p={username:'owner',display_name:'管理员',password:'Secure-test-pass-1234',setup_token:env.ADMIN_SETUP_TOKEN};const r=await send('POST','/api/setup/admin',p);assert.equal(r.status,200);const again=await send('POST','/api/setup/admin',p);assert.equal(again.status,409);});
await test('密码错误拒绝，正确密码创建会话 cookie',async()=>{assert.equal((await send('POST','/api/login',{username:'owner',password:'incorrect'})).status,401);const r=await send('POST','/api/login',{username:'owner',password:'Secure-test-pass-1234'});assert.equal(r.status,200);assert.match(r.cookie,/HttpOnly/);assert.match(r.cookie,/SameSite=Strict/);admin=cookie(r);assert.ok(admin);});
await test('管理员新建两名普通成员并检查返回字段脱敏',async()=>{for(const [name,label] of [['member_a','甲'],['member_b','乙']]){const r=await send('POST','/api/users',{username:name,display_name:label,role:'member',password:'Members-Password-1234'},admin);assert.equal(r.status,201);assert.equal(r.body.data.user.role,'member');assert.equal(JSON.stringify(r.body).includes('hash'),false);const login=await send('POST','/api/login',{username:name,password:'Members-Password-1234'});assert.equal(login.status,200);if(name==='member_a')a=cookie(login);else b=cookie(login);}});
await test('管理员创建耗材，初始库存0且不允许直接传库存',async()=>{const bad=await send('POST','/api/items',{code:'LAB-A',name:'手套',unit:'盒',current_stock:100},admin);assert.equal(bad.status,400);const r=await send('POST','/api/items',{code:'LAB-A',name:'手套',unit:'盒',min_stock:5,location:'A-1'},admin);assert.equal(r.status,201);assert.equal(r.body.data.item.current_stock,0);itemId=r.body.data.item.id;});
await test('入库20时写入流水并更新库存',async()=>{const r=await send('POST','/api/movements',{business_no:'IN-A',item_id:itemId,type:'IN',quantity:20,note:'测试入库'},admin);assert.equal(r.status,201);assert.equal(r.body.data.current_stock,20);});
await test('普通成员不能入库或管理成员',async()=>{assert.equal((await send('POST','/api/movements',{business_no:'X',item_id:itemId,type:'IN',quantity:2},a)).status,403);assert.equal((await send('GET','/api/users',undefined,a)).status,403);});
await test('成员A领用15后只显示其记录且预警',async()=>{const s=await send('GET','/api/state',undefined,admin);const recipient=s.body.data.users.find(u=>u.username==='member_a').id;
 const r=await send('POST','/api/movements',{business_no:'OUT-A',item_id:itemId,type:'OUT',quantity:15,recipient_id:recipient,note:'课程实验'},admin);assert.equal(r.status,201);assert.equal(r.body.data.current_stock,5);
 const sA=await send('GET','/api/state',undefined,a);const sB=await send('GET','/api/state',undefined,b);assert.equal(sA.body.data.movements.length,1);assert.equal(sB.body.data.movements.length,0);assert.equal(sA.body.data.items[0].current_stock,5);
 assert.equal((await send('GET','/api/movements?recipient_id='+recipient,undefined,b)).status,403);
});
await test('同单号重试幂等且修改单号内容被拒绝',async()=>{const s=await send('GET','/api/state',undefined,admin);const recipient=s.body.data.users.find(u=>u.username==='member_a').id;
 const p={business_no:'OUT-A',item_id:itemId,type:'OUT',quantity:15,recipient_id:recipient,note:'课程实验'};const r=await send('POST','/api/movements',p,admin);assert.equal(r.status,200);assert.equal(r.body.data.idempotent,true);assert.equal(r.body.data.current_stock,5);
 assert.equal((await send('POST','/api/movements',{...p,quantity:1},admin)).status,409);
});
await test('并发各领用4，只允许一笔成功且库存不为负',async()=>{const s=await send('GET','/api/state',undefined,admin);const recipient=s.body.data.users.find(u=>u.username==='member_a').id;
 const jobs=await Promise.all(['OUT-1','OUT-2'].map(no=>send('POST','/api/movements',{business_no:no,item_id:itemId,type:'OUT',quantity:4,recipient_id:recipient},admin)));
 assert.deepEqual(jobs.map(j=>j.status).sort(),[201,409]);const fresh=await send('GET','/api/state',undefined,admin);assert.equal(fresh.body.data.items[0].current_stock,1);
});
await test('库存核对差额为0',async()=>{const r=await send('GET','/api/reconciliation',undefined,admin);assert.equal(r.status,200);assert.equal(r.body.data.rows[0].difference,0);});
await test('跨站写入请求拒绝',async()=>{const r=await send('POST','/api/items',{code:'X',name:'X',unit:'个'},admin,'https://evil.example');assert.equal(r.status,403);});
await test('管理员不能停用自己、无法执行云端数据重置',async()=>{const s=await send('GET','/api/state',undefined,admin);assert.equal((await send('PATCH','/api/users/'+s.body.data.user.id,{active:false},admin)).status,409);
 assert.equal((await send('POST','/api/demo/reset',{confirm:'RESET_DEMO'},admin)).status,403);
});
await test('停用成员后原会话失效，历史仍保留',async()=>{const s=await send('GET','/api/state',undefined,admin);const u=s.body.data.users.find(x=>x.username==='member_b');assert.equal((await send('PATCH','/api/users/'+u.id,{active:false},admin)).status,200);assert.equal((await send('GET','/api/state',undefined,b)).status,401);
 const after=await send('GET','/api/state',undefined,admin);assert.equal(after.body.data.users.find(x=>x.id===u.id).active,false);
});
await test('用户修改密码旧会话失效，新密码登录成功',async()=>{const r=await send('POST','/api/account/password',{current_password:'Members-Password-1234',new_password:'Another-Good-Password-1234'},a);assert.equal(r.status,200);
 assert.equal((await send('GET','/api/state',undefined,a)).status,401);
 assert.equal((await send('POST','/api/login',{username:'member_a',password:'Another-Good-Password-1234'})).status,200);
});
await test('登录失败五次后短暂锁定，不能无限猜测密码',async()=>{
  for(let i=0;i<5;i++){const r=await send('POST','/api/login',{username:'nobody',password:'wrong-password'});assert.equal(r.status,401);}
  const lock=await send('POST','/api/login',{username:'nobody',password:'wrong-password'});assert.equal(lock.status,429);
});
await test('静态资源请求交给Assets',async()=>{const r=await worker.fetch(new Request(origin+'/app.html'),env);assert.equal(r.status,200);assert.equal(await r.text(),'Demo HTML');});
console.log(`TOTAL ${counts.length}, PASSED ${counts.filter(x=>x[1]==='PASS').length}, FAILED ${counts.filter(x=>x[1]==='FAIL').length}`);
if(counts.some(x=>x[1]==='FAIL'))process.exit(1);
