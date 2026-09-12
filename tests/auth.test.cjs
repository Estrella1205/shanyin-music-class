const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createApp}=require('../server/auth-server.cjs');
test('local accounts: registration, errors, password hashing, isolated data, profile, logout, password change, restart',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'shengru-test-'));let server=createApp({dataDir:dir});await new Promise(r=>server.listen(0,'127.0.0.1',r));let base=`http://127.0.0.1:${server.address().port}`;
 const client=()=>({cookie:''});const a=client(),b=client(),guest=client();
 async function req(c,p,method='GET',data,extra={}){const r=await fetch(base+'/api/'+p,{method,headers:{'Content-Type':'application/json','X-Shengru-Client':'local-web',cookie:c.cookie,...extra},body:data?JSON.stringify(data):undefined});const ck=r.headers.get('set-cookie');if(ck)c.cookie=ck.split(';')[0];return {status:r.status,data:await r.json(),headers:r.headers}}
 try{
  assert.equal((await req(guest,'state','PUT',{state:{}})).status,401);
  const reg=await req(a,'register','POST',{username:'test_teacher_a',password:'test-password-123',name:'测试老师甲'});assert.equal(reg.status,200);assert.match(reg.headers.get('set-cookie'),/HttpOnly; SameSite=Strict/);assert.equal(reg.data.user.passwordHash,undefined);
  assert.equal((await req(b,'register','POST',{username:'test_teacher_a',password:'another-password',name:'重复'})).status,409);
  assert.equal((await req(b,'login','POST',{username:'test_teacher_a',password:'wrong-password'})).status,401);
  assert.equal((await req(a,'profile','PATCH',{name:'徐老师',school:'测试山野小学',avatar:'👩🏻‍🏫'})).status,200);
  assert.equal((await req(a,'state','PUT',{state:{song:'茉莉花',records:[{test:1}]}})).status,200);
  await req(b,'register','POST',{username:'test_teacher_b',password:'test-password-456',name:'测试老师乙'});
  assert.equal((await req(b,'session')).data.state,null);assert.equal((await req(a,'session')).data.state.records.length,1);
  assert.equal((await req(a,'profile','PATCH',{name:'坏来源',school:'',avatar:'👩🏻‍🏫'},{Origin:'https://other.invalid'})).status,403);
  assert.equal((await req(a,'password','POST',{current:'test-password-123',password:'new-test-password-123'})).status,200);
  const old=a.cookie;await req(a,'logout','POST',{});assert.equal((await req({cookie:old},'session')).data.user,null);
  assert.equal((await req(a,'login','POST',{username:'test_teacher_a',password:'test-password-123'})).status,401);
  assert.equal((await req(a,'login','POST',{username:'test_teacher_a',password:'new-test-password-123'})).status,200);
  const raw=fs.readFileSync(path.join(dir,'accounts.json'),'utf8');assert.ok(!raw.includes('test-password-123'));assert.ok(!raw.includes('test-password-456'));
  await new Promise(r=>server.close(r));server=createApp({dataDir:dir});await new Promise(r=>server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${server.address().port}`;
  assert.equal((await req(a,'session')).data.user,null);const login=await req(a,'login','POST',{username:'test_teacher_a',password:'new-test-password-123'});assert.equal(login.data.user.school,'测试山野小学');assert.equal(login.data.state.records.length,1);
 }finally{await new Promise(r=>server.close(r));const resolved=path.resolve(dir);assert.ok(resolved.startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(resolved).startsWith('shengru-test-'));fs.rmSync(resolved,{recursive:true,force:true})}
});
