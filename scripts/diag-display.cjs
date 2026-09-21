const fs=require('fs');const http=require('http');
function httpGetJson(url){return new Promise((resolve,reject)=>{const req=http.get(url,res=>{let s='';res.on('data',c=>s+=c);res.on('end',()=>resolve(JSON.parse(s)))});req.on('error',reject)})}
async function main(){
  const targets=await httpGetJson('http://127.0.0.1:9333/json');
  const page=targets.find(t=>t.type==='page');
  const ws=new WebSocket(page.webSocketDebuggerUrl);let id=0;const pending=new Map();
  ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(new Error(JSON.stringify(m.error))):p.resolve(m.result)}};
  const send=(method,params)=>new Promise((resolve,reject)=>{const mid=++id;pending.set(mid,{resolve,reject});ws.send(JSON.stringify({id:mid,method,params}))});
  await new Promise(r=>ws.onopen=r);
  await send('Page.navigate',{url:'http://127.0.0.1:4173/#display'});
  await new Promise(r=>setTimeout(r,2000));
  let diag;
  try{
    const r=await send('Runtime.evaluate',{expression:`JSON.stringify({route:state.route,hasDisplayView:typeof displayView,hasScreen:!!document.querySelector('.display-screen'),scripts:Array.from(document.scripts).map(s=>s.src.split('/').pop()),appStart:document.querySelector('#app')?.innerHTML.slice(0,150)})`,returnByValue:true});
    diag=r.result.value;
  }catch(e){diag='EVAL_ERR:'+e.message}
  fs.writeFileSync('C:\\Users\\ASUS\\AppData\\Local\\Temp\\diag.json',diag,'utf8');
  ws.close();
}
main().catch(e=>{fs.writeFileSync('C:\\Users\\ASUS\\AppData\\Local\\Temp\\diag.json','MAIN_ERR:'+e.message,'utf8')});
