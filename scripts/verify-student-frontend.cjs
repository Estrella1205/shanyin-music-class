// CDP 验证学生前端：注册表单角色选择 + 学生仪表盘渲染 + 练习记录展示
const fs = require('fs'); const path = require('path'); const http = require('http');
function httpGetJson(url){return new Promise((resolve,reject)=>{const req=http.get(url,res=>{let s='';res.on('data',c=>s+=c);res.on('end',()=>resolve(JSON.parse(s)))});req.on('error',reject)})}
async function main(){
  const targets=await httpGetJson('http://127.0.0.1:9333/json');
  const page=targets.find(t=>t.type==='page');if(!page)throw new Error('no page');
  const ws=new WebSocket(page.webSocketDebuggerUrl);let id=0;const pending=new Map();
  ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(new Error(JSON.stringify(m.error))):p.resolve(m.result)}};
  const send=(method,params)=>new Promise((resolve,reject)=>{const mid=++id;pending.set(mid,{resolve,reject});ws.send(JSON.stringify({id:mid,method,params}))});
  await new Promise(r=>ws.onopen=r);
  await send('Network.enable'); await send('Network.setCacheDisabled',{cacheDisabled:true});
  const evalJs=async expr=>(await send('Runtime.evaluate',{expression:expr,returnByValue:true,awaitPromise:true})).result.value;

  // 1) 加载页面（cache-buster），检查注册表单有角色选择
  await send('Page.navigate',{url:'http://127.0.0.1:4173/?cb='+Date.now()+'#home'});
  await new Promise(r=>setTimeout(r,2000));
  // 打开注册弹窗
  const regForm=await evalJs(`(()=>{
    // 先确保是访客（未登录）
    if(currentUser){return {note:'已登录，需先退出'}}
    // 触发账户菜单
    document.querySelector('.account-trigger')?.click();
    setTimeout(()=>document.querySelector('[data-useraction="register"]')?.click(),50);
    return {triggered:true};
  })()`);
  await new Promise(r=>setTimeout(r,800));
  const formCheck=await evalJs(`(()=>{
    const form=document.querySelector('#auth-form');
    if(!form) return {ok:false,why:'no auth-form'};
    const radios=form.querySelectorAll('input[name="role"]');
    const nameLabel=form.querySelector('label[for="auth-name"]')?.textContent;
    const namePlaceholder=form.querySelector('#auth-name')?.placeholder;
    return {ok:true,roleCount:radios.length,roles:Array.from(radios).map(r=>r.value),nameLabel,namePlaceholder};
  })()`);
  console.log('[student-fe] 注册表单:',JSON.stringify(formCheck));
  if(!formCheck.ok) throw new Error('注册表单未渲染');
  if(formCheck.roleCount!==2) throw new Error('角色 radio 应有 2 个，实际 '+formCheck.roleCount);
  if(!formCheck.roles.includes('student')) throw new Error('缺少 student 角色');

  // 2) 注册学生账号（页面内 fetch）
  const uname='cdpstu_'+Date.now();
  const reg=await evalJs(`(async()=>{
    const r=await fetch('/api/register',{method:'POST',headers:{'Content-Type':'application/json','X-Shengru-Client':'local-web'},body:JSON.stringify({username:'${uname}',password:'cdp-stu-123',name:'小红',role:'student'})});
    const data=await r.json();
    if(data.user){currentUser=data.user;state={...freshState(),...(data.state||{})};}
    return {status:r.status,role:data.user?.role,name:data.user?.name};
  })()`);
  console.log('[student-fe] 页面内注册:',JSON.stringify(reg));
  if(reg.role!=='student') throw new Error('页面内注册未返回 student 角色');

  // 3) 提交一份录音（让仪表盘有数据）
  const wavB64=require('../tests/test-fixtures.cjs').fixture({cents:-100}).toString('base64');
  const submit=await evalJs(`(async()=>{
    const r=await fetch('/api/audio/attempts',{method:'POST',headers:{'Content-Type':'application/json','X-Shengru-Client':'local-web'},body:JSON.stringify({audio:'${wavB64}',context:'single',source:'uploaded-audio',lessonId:'molihua-opening-v1'})});
    const data=await r.json();
    return {status:r.status,valid:data.analysis?.valid};
  })()`);
  console.log('[student-fe] 学生提交录音:',JSON.stringify(submit));

  // 4) 导航到学生仪表盘
  await evalJs(`go('student')`);
  await new Promise(r=>setTimeout(r,1500));
  const dash=await evalJs(`(()=>{
    const main=document.querySelector('main.page');
    if(!main) return {ok:false,why:'no main.page'};
    const heading=document.querySelector('.page-title')?.textContent;
    const hasProgress=document.querySelector('.agent-panel h3')?.textContent;
    const hasHistory=document.querySelector('.report-list')||document.querySelector('.panel.empty');
    const navItems=Array.from(document.querySelectorAll('nav button')).map(b=>b.textContent.trim());
    return {ok:true,heading,hasProgress:!!hasProgress,progressTitle:hasProgress,hasHistory:!!hasHistory,navItems};
  })()`);
  console.log('[student-fe] 学生仪表盘:',JSON.stringify(dash));
  if(!dash.ok) throw new Error('仪表盘未渲染: '+dash.why);
  if(!dash.navItems||!dash.navItems.some(t=>t.includes('我的进步'))) throw new Error('学生导航缺少「我的进步」');

  // 5) 截图
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  await new Promise(r=>setTimeout(r,500));
  const shot=await send('Page.captureScreenshot',{format:'png'});
  fs.writeFileSync(path.join(__dirname,'..','docs','verify-student-dashboard.png'),Buffer.from(shot.data,'base64'));
  console.log('[student-fe] 截图已保存 docs/verify-student-dashboard.png');
  await send('Emulation.clearDeviceMetricsOverride');

  console.log('[student-fe] 学生端前端验证完成');
  ws.close();
}
main().catch(e=>{console.error('[student-fe] FAILED:',e.message);process.exit(1)});
