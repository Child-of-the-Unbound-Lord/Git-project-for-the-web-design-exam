// Local-only Worker+D1 emulator to exercise browser requests. No remote data.
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import worker from '../src/worker.mjs';
const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'..');
const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');
const DB={async exec(sql){db.exec(sql);return {};},prepare(sql){let params=[];return {bind(...x){params=x;return this;},async first(){return db.prepare(sql).get(...params)||null;},async all(){return {results:db.prepare(sql).all(...params)};},async run(){return {meta:{changes:Number(db.prepare(sql).run(...params).changes)}};}};}};
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.zip':'application/zip','.txt':'text/plain; charset=utf-8'};
const env={DB,ADMIN_SETUP_TOKEN:'TEST-ONLY-setup-token-please-keep-secret-12345',ASSETS:{async fetch(request){const u=new URL(request.url);const relative=decodeURIComponent(u.pathname==='/'?'/index.html':u.pathname).slice(1);if(relative.includes('..'))return new Response('bad request',{status:400});try{const file=await readFile(path.join(root,'dist',relative));return new Response(file,{headers:{'content-type':mime[path.extname(relative)]||'application/octet-stream'}})}catch{return new Response('Not Found',{status:404})}}}};
const port=Number(process.env.PORT||8788);
createServer(async(req,res)=>{
  try{
    const chunks=[];for await(const c of req)chunks.push(c);
    const url='http://127.0.0.1:'+port+req.url;
    const headers={...req.headers};
    const wreq=new Request(url,{method:req.method,headers,body:['GET','HEAD'].includes(req.method)?undefined:Buffer.concat(chunks)});
    const wres=await worker.fetch(wreq,env);
    res.writeHead(wres.status,Object.fromEntries(wres.headers));res.end(Buffer.from(await wres.arrayBuffer()));
  }catch(e){console.error(e);res.writeHead(500);res.end(String(e));}
}).listen(port,'127.0.0.1',()=>console.log('LabFlow Cloud local test http://127.0.0.1:'+port));
