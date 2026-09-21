const fs=require('fs');const http=require('http');
function httpGetJson(url){return new Promise((resolve,reject)=>{const req=http.get(url,res=>{let s='';res.on('data',c=>s+=c);res.on('end',()=>resolve(JSON.parse(s)))});req.on('error',reject)})}
async function main(){
  const targets=await httpGetJson('http://127.0.0.1:9333/json');
  const page=targets.find(t=>t.type==='page');
  const ws=new WebSocket(page.webSocketDebuggerUrl);let id=0;const pending=new Map();
  ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(new Error(JSON.stringify(m.error))):p.resolve(m.result)}};
  const send=(method,params)=>new Promise((resolve,reject)=>{const mid=++id;pending.set(mid,{resolve,reject});ws.send(JSON.stringify({id:mid,method,params}))});
  await new Promise(r=>ws.onopen=r);
  const evalJs=async expr=>(await send('Runtime.evaluate',{expression:expr,returnByValue:true,awaitPromise:true})).result.value;
  // 关掉弹窗，重截干净的仪表盘
  await evalJs(`closeModal();go('student');'ok'`);
  await new Promise(r=>setTimeout(r,1500));
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  await new Promise(r=>setTimeout(r,600));
  const shot=await send('Page.captureScreenshot',{format:'png'});
  fs.writeFileSync('E:\\\\文件大集合\\\\AI音乐课\\\\shanyin-demo\\\\docs\\\\verify-student-dashboard.png',Buffer.from(shot.data,'base64'));
  console.log('saved');
  ws.close();
}
main().catch(e=>{console.error('FAIL',e.message);process.exit(1)});
