// Render-level smoke checks for all app routes without a browser/network dependency.
// This is NOT a replacement for manual screenshot/cross-browser acceptance.
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../web/app.js'),'utf8');
const user={id:'ADMIN',username:'owner',display_name:'测试管理员',role:'admin',active:true};
const member={id:'A',username:'member_a',display_name:'成员A',role:'member',active:true};
const sample={user,users:[user,member],items:[{id:'I-1',code:'LAB-01',name:'手套',unit:'盒',spec:'M',location:'A-01',min_stock:5,current_stock:20,active:true}],movements:[],mode:'server',cloud:true};
const cases=[];
async function run(initial,route){
 let root={innerHTML:'',addEventListener(){},querySelectorAll(){return[]}};
 let modal={innerHTML:'',addEventListener(){}};
 let toast={appendChild(){}};
 let content={innerHTML:''};
 let breadcrumb={textContent:''};
 const els={'app':root,'modal-root':modal,'toast-root':toast,'main-content':content,'breadcrumb-current':breadcrumb,'stock-preview':{innerHTML:''},'quantity-unit':{innerHTML:''}};
 const doc={body:{classList:{add(){},remove(){},toggle(){}}},documentElement:{dataset:{}},
   getElementById(id){return els[id]||{innerHTML:'',addEventListener(){},textContent:''}},addEventListener(){},title:''};
 const win={location:{href:'https://example.workers.dev/app.html?app='+route},crypto:{randomUUID:()=> '10991111-2222-3333-4444-555555555555'},history:{pushState(){}},scrollTo(){},addEventListener(){},setTimeout(){}};
 const api={mode:'server',init:async()=>({}),session:async()=>({mode:'server',cloud:true,user:initial==='setup'?null:user}),setupStatus:async()=>({needs_setup:true,configured:true}),state:async()=>sample};
 const context={window:win,document:doc,URL,Intl,Date,Number,String,Array,Object,Math,Error,Promise,FormData,setTimeout,console};
 win.LabAPI=api;
 vm.runInNewContext(source,context,{filename:'web/app.js'});
 await new Promise(r=>setTimeout(r,20));
 return {html:root.innerHTML,content:content.innerHTML,bodyTitle:doc.title};
}
(async()=>{
 const first=await run('setup','home');
 assert.match(first.html,/创建首位管理员/);assert.doesNotMatch(first.html,/快速填入示例账号/);cases.push('首次初始化页面');
 const expected={home:'工作从这里开始',items:'耗材档案',inbound:'入库登记',outbound:'领用登记',inventory:'库存查询',movements:'出入库流水',alerts:'低库存预警',reconciliation:'库存核对',statistics:'数据统计',users:'成员管理'};
 for(const [route,title] of Object.entries(expected)){
  const p=await run('logged',route);
  assert.ok(p.content.includes(title),route+' missing heading');
  assert.ok(!p.content.includes('程序发生错误'),route);
  assert.match(p.html,/云端共享库存/);
  assert.ok(!p.html.includes('重置示例数据'),route+' cloud reset should be hidden');
  cases.push(route);
 }
 console.log('UI render smoke:',cases.length,'scenarios passed:',cases.join(', '));
})().catch(e=>{console.error(e.stack||e);process.exit(1)});
