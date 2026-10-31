const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'); const path=require('node:path');
const {execFileSync}=require('node:child_process');

test('account API settings: authentication, encrypted persistence, account isolation, update and removal', {timeout:60000}, async()=>{
 const root=path.resolve(__dirname,'../..');const folder=path.join(root,'.cache/account-tests');fs.mkdirSync(folder,{recursive:true});
 const db=path.join(folder,`test-${process.pid}-${Date.now()}.db`);fs.closeSync(fs.openSync(db,'wx'));
 process.env.DATABASE_URL=`file:${db.split(path.sep).join('/')}`;process.env.NODE_ENV='test';process.env.CLOUD_SUMMARY_STUB='1';
 execFileSync(process.execPath,[require.resolve('prisma/build/index.js'),'migrate','deploy','--schema',path.join(root,'apps/server/prisma/schema.prisma')],{env:process.env,stdio:'pipe',timeout:30000});
 const {app}=require('../../apps/server/dist/app');const {prisma}=require('../../apps/server/dist/config/db');
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 const base=`http://127.0.0.1:${server.address().port}`;
 const request=(route,token,body,method='POST')=>fetch(base+route,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{})});
 try{
  assert.equal((await request('/account/cloud',null,null,'GET')).status,401);
  const tokens=[];
  for(const username of ['alice','bob']){const credentials={username,password:'Fixture!Password123'};assert.equal((await request('/register',null,credentials)).status,201);tokens.push((await(await request('/login',null,credentials)).json()).token);}
  const config={provider:'gemini',model:'gemini-3.8-flash',apiKey:'synthetic-account-fixture-key'};
  assert.equal((await request('/account/cloud',tokens[0],config)).status,200);
  const visible=await(await request('/account/cloud',tokens[0],null,'GET')).json();assert.equal(visible.configured,true);assert.equal(JSON.stringify(visible).includes(config.apiKey),false);assert.equal('encryptedKey' in visible,false);
  assert.equal((await(await request('/account/cloud',tokens[1],null,'GET')).json()).configured,false);
  const row=await prisma.cloudCredential.findUnique({where:{username:'alice'}});assert.ok(row);assert.equal(row.encryptedKey.includes(config.apiKey),false);
  execFileSync(process.execPath,['-e',"(async()=>{const a=require('./apps/server/dist/repositories/AccountCloudSettings');const p=require('./apps/server/dist/config/db').prisma;try{if((await a.readSettings('alice')).apiKey!=='synthetic-account-fixture-key')process.exitCode=1;}finally{await p.$disconnect();}})().catch(()=>{process.exitCode=1;});"],{cwd:root,env:process.env,stdio:'pipe',timeout:15000});
  assert.equal((await request('/account/cloud',tokens[0],{...config,apiKey:'',model:'another-model'})).status,200);
  assert.equal((await request('/account/cloud',tokens[0],{provider:'custom',endpoint:'http://example.com',apiKey:'bad'})).status,400);
  assert.equal((await request('/account/cloud',tokens[1],{provider:'gemini',model:'gemini-3.8-flash',apiKey:''})).status,400);
  assert.equal((await request('/account/cloud/delete',tokens[1])).status,200);
  assert.equal((await(await request('/account/cloud',tokens[0],null,'GET')).json()).configured,true);
  assert.equal((await request('/account/cloud/delete',tokens[0])).status,200);
  assert.equal(await prisma.cloudCredential.count(),0);
 }finally{await new Promise(resolve=>server.close(resolve));await prisma.$disconnect();}
});

test('live provider formats: Gemini inline PDF and custom relay, errors and cancellation signal',async()=>{
 const {accountSummary,validateConfig}=require('../../apps/server/dist/repositories/AccountCloudSettings');
 const original=global.fetch; const signal=new AbortController().signal; const pdf=Buffer.from('%PDF-fixture');
 try{
  global.fetch=async(url,options)=>{assert.match(url,/generativelanguage.googleapis.com/);assert.equal(url.includes('fixture-key'),false);assert.equal(options.headers['x-goog-api-key'],'fixture-key');assert.equal(options.signal,signal);assert.equal(options.redirect,'error');const body=JSON.parse(options.body);assert.equal(body.contents[0].parts[0].inline_data.data,pdf.toString('base64'));return Response.json({candidates:[{content:{parts:[{thought:true,text:'hidden'},{text:'A summary'}]}}]});};
  assert.equal(await accountSummary(validateConfig({provider:'gemini',model:'gemini-3.8-flash'}),'fixture-key',pdf,signal),'A summary');
  global.fetch=async(url,options)=>{assert.equal(url,'https://relay.example/summary');assert.equal(options.headers.Authorization,'Bearer fixture-key');assert.deepEqual(Buffer.from(options.body),pdf);return Response.json({summary:'Relay summary'});};
  const custom=validateConfig({provider:'custom',endpoint:'https://relay.example/summary'});
  assert.equal(await accountSummary(custom,'fixture-key',pdf,signal),'Relay summary');
  global.fetch=async()=>new Response('',{status:401});await assert.rejects(accountSummary(custom,'fixture-key',pdf,signal),/HTTP 401/);
  const {CloudProviderError}=require('../../apps/server/dist/services/CloudProviderError');
  for(const [code,expected] of [[400,/request/],[403,/denied access/],[404,/not found/],[429,/quota/],[503,/HTTP 503/]]){global.fetch=async()=>Response.json({error:{message:'fixture-key must never leak'}},{status:code});await assert.rejects(accountSummary(custom,'fixture-key',pdf,signal),error=>error instanceof CloudProviderError && expected.test(error.message) && !error.message.includes('fixture-key'));}
  global.fetch=async()=>{throw Object.assign(new TypeError('secret fixture-key'),{cause:{code:'UNABLE_TO_VERIFY_LEAF_SIGNATURE'}});};
  await assert.rejects(accountSummary(custom,'fixture-key',pdf,signal),/certificate validation/);
  global.fetch=async()=>Response.json({summary:''});await assert.rejects(accountSummary(custom,'fixture-key',pdf,signal),/empty summary/);
 }finally{global.fetch=original;}
});
