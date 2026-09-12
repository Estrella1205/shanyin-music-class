const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {promisify}=require('node:util');const scrypt=promisify(crypto.scrypt);
function createApp({dataDir=path.join(__dirname,'..','../.local-data'),agentAdapter}={}){
 const agent=require('./teaching-agent.cjs').createAgent({dataDir,adapter:agentAdapter});
 const audioStore=require('./audio-store.cjs').createAudioStore(dataDir);
 const reportBuilder=require('./report-builder.cjs');
 const root=path.join(__dirname,'..','public'),dbFile=path.join(dataDir,'accounts.json');
 fs.mkdirSync(dataDir,{recursive:true});let db={users:[]};if(fs.existsSync(dbFile))db=JSON.parse(fs.readFileSync(dbFile,'utf8'));
 const sessions=new Map(),attempts=new Map();
 const save=()=>{fs.writeFileSync(dbFile+'.tmp',JSON.stringify(db),{mode:0o600});fs.renameSync(dbFile+'.tmp',dbFile)};
 const publicUser=u=>({id:u.id,username:u.username,name:u.name,school:u.school,avatar:u.avatar});
 const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data))};
 const cookie=(res,token,maxAge=43200)=>res.setHeader('Set-Cookie',`srsy_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}`);
 const tokenOf=req=>(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('srsy_session='))?.slice(13);
 const userOf=req=>{const token=tokenOf(req),session=sessions.get(token);if(!session)return null;if(session.expires<Date.now()){sessions.delete(token);return null}return db.users.find(u=>u.id===session.id)};
 async function body(req,limit=350000){let size=0,parts=[];for await(const part of req){size+=part.length;if(size>limit)throw new Error('请求内容过大');parts.push(part)}return JSON.parse(Buffer.concat(parts).toString()||'{}')}
 async function hash(password,salt){return (await scrypt(password,salt,64)).toString('hex')}
 function issue(req,res,u){sessions.delete(tokenOf(req));const token=crypto.randomBytes(32).toString('hex');sessions.set(token,{id:u.id,expires:Date.now()+43200000});cookie(res,token)}
 return http.createServer(async(req,res)=>{res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');
 try{const route=new URL(req.url,'http://localhost').pathname;
 if(route.startsWith('/api/')){
  if(!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.host||''))return json(res,403,{error:'仅允许本机访问'});
  if(req.method!=='GET'){
   if(req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`)return json(res,403,{error:'请求来源不匹配'});
   if(req.headers['x-shengru-client']!=='local-web')return json(res,403,{error:'请求校验失败'});
   if(!req.headers['content-type']?.startsWith('application/json'))return json(res,415,{error:'需要 JSON 请求'});
  }
  const user=userOf(req);
  if(route==='/api/session'&&req.method==='GET')return json(res,200,{user:user?publicUser(user):null,state:user?.state||null});
  if((route==='/api/register'||route==='/api/login')&&req.method==='POST'){
   const key=req.socket.remoteAddress;let rate=attempts.get(key);if(!rate||rate.until<Date.now()){rate={n:0,until:Date.now()+900000};attempts.set(key,rate)}if(++rate.n>30)return json(res,429,{error:'尝试次数过多，请15分钟后再试'});
   const b=await body(req),username=String(b.username||'').trim().toLowerCase(),password=String(b.password||'');
   if(!/^[a-z0-9_.-]{3,32}$/.test(username)||password.length<8||password.length>128)return json(res,400,{error:'账号需为3–32位英文、数字或._-，密码需为8–128位'});
   let u=db.users.find(x=>x.username===username);
   if(route==='/api/register'){
    if(u)return json(res,409,{error:'这个账号已注册，请登录或更换账号'});
    const name=String(b.name||'').trim();if(!name||name.length>20)return json(res,400,{error:'请填写1–20字的教师称呼'});
    const salt=crypto.randomBytes(16).toString('hex'),passwordHash=await hash(password,salt);
    if(db.users.some(x=>x.username===username))return json(res,409,{error:'这个账号已注册'});
    u={id:crypto.randomUUID(),username,name,school:'',avatar:'🧑🏻‍🏫',salt,passwordHash,state:null};db.users.push(u);save();
   }else{
    const candidate=await hash(password,u?.salt||'invalid-user-salt');
    if(!u||!crypto.timingSafeEqual(Buffer.from(candidate,'hex'),Buffer.from(u.passwordHash,'hex')))return json(res,401,{error:'账号或密码不正确'});
   }
   issue(req,res,u);return json(res,200,{user:publicUser(u),state:u.state});
  }
  if(route==='/api/logout'&&req.method==='POST'){sessions.delete(tokenOf(req));cookie(res,'',0);return json(res,200,{ok:true})}
  if(!user)return json(res,401,{error:'请先登录'});
  if(route==='/api/audio/attempts'&&req.method==='GET')return json(res,200,{attempts:audioStore.list(user.id)});
  if(route==='/api/audio/attempts'&&req.method==='POST'){try{return json(res,201,await audioStore.submit(user.id,await body(req,900000)))}catch(e){return json(res,400,{error:e.message})}}
  const audioRoute=route.match(/^\/api\/audio\/attempts\/([a-f0-9-]{36})(?:\/(wav|practice))?$/);
  if(audioRoute){const [,id,action]=audioRoute;if(action==='practice'&&req.method==='POST'){try{return json(res,200,audioStore.practice(id,user.id))}catch{return json(res,404,{error:'录音不存在'})}}if(req.method==='GET'){const r=action==='wav'?audioStore.audio(id,user.id):audioStore.get(id,user.id);if(!r)return json(res,404,{error:'录音不存在'});if(action==='wav'){res.writeHead(200,{'Content-Type':'audio/wav','Cache-Control':'no-store'});return res.end(r)}return json(res,200,r)}}
  if(route==='/api/reports/overview'&&req.method==='GET')return json(res,200,reportBuilder.buildReport(user.id,audioStore.list(user.id)));
  if(route==='/api/agent/status'&&req.method==='GET')return json(res,200,{configured:agent.configured});
  if(route==='/api/agent/tasks'&&req.method==='GET')return json(res,200,{tasks:agent.list(user.id)});
  if(route==='/api/agent/tasks'&&req.method==='POST'){
   try{return json(res,202,agent.start(user.id,await body(req)))}catch(e){return json(res,e.message==='AGENT_BUSY'?429:400,{error:({MODEL_NOT_CONFIGURED:'服务端尚未配置 TEACHING_API_KEY 和 TEACHING_MODEL',AGENT_BUSY:'已有任务运行中，请稍后重试',UNSUPPORTED_LESSON:'真实教学 Agent 当前仅支持已校对的《茉莉花》'})[e.message]||'请检查课堂需求与条件'})}
  }
  const agentAction=route.match(/^\/api\/agent\/tasks\/([a-f0-9-]{36})\/(cancel|retry)$/);
  if(agentAction&&req.method==='POST'){
   const [,id,action]=agentAction;
   try{const task=action==='cancel'?agent.cancel(id,user.id):agent.retry(id,user.id);return json(res,task?(action==='retry'?202:200):404,task||{error:'任务不存在'})}catch(e){return json(res,e.message==='AGENT_BUSY'?429:400,{error:{AGENT_BUSY:'已有任务运行中，请稍后重试',MODEL_NOT_CONFIGURED:'服务端尚未配置 TEACHING_API_KEY 和 TEACHING_MODEL'}[e.message]||'操作未完成'})}
  }
  if(route.startsWith('/api/agent/tasks/')&&req.method==='GET'){const task=agent.get(route.split('/').pop(),user.id);return json(res,task?200:404,task||{error:'任务不存在'});}
  if(route==='/api/profile'&&req.method==='PATCH'){
   const b=await body(req),name=String(b.name||'').trim(),school=String(b.school||'').trim();
   if(!name||name.length>20||school.length>50)return json(res,400,{error:'称呼需为1–20字，学校最多50字'});
   if(!['🧑🏻‍🏫','👩🏻‍🏫','👨🏻‍🏫','🧑🏻‍🌾','👩🏻‍🎨'].includes(b.avatar))return json(res,400,{error:'请选择提供的头像'});
   Object.assign(user,{name,school,avatar:b.avatar});save();return json(res,200,{user:publicUser(user)});
  }
  if(route==='/api/password'&&req.method==='POST'){
   const b=await body(req);if(typeof b.password!=='string'||b.password.length<8||b.password.length>128||typeof b.current!=='string'||b.current.length>128)return json(res,400,{error:'新密码需为8–128位'});
   const previous=await hash(b.current,user.salt);if(!crypto.timingSafeEqual(Buffer.from(previous,'hex'),Buffer.from(user.passwordHash,'hex')))return json(res,401,{error:'原密码不正确'});
   user.salt=crypto.randomBytes(16).toString('hex');user.passwordHash=await hash(b.password,user.salt);save();for(const [k,v] of sessions)if(v.id===user.id)sessions.delete(k);issue(req,res,user);return json(res,200,{ok:true});
  }
  if(route==='/api/state'&&req.method==='PUT'){
   const b=await body(req);if(!b.state||typeof b.state!=='object'||Array.isArray(b.state))return json(res,400,{error:'课堂数据格式不正确'});
   user.state=b.state;save();return json(res,200,{ok:true});
  }
  return json(res,404,{error:'未找到接口'});
 }
 let pathname;try{pathname=decodeURIComponent(route)}catch{return json(res,400,{error:'路径不正确'})}
 const file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));if(!file.startsWith(root+path.sep))return json(res,403,{error:'禁止访问'});
 fs.readFile(file,(err,data)=>{if(err){res.writeHead(404);res.end('Not found');return}res.setHeader('Cache-Control','no-cache');res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.png':'image/png','.wav':'audio/wav','.json':'application/json; charset=utf-8'})[path.extname(file)]||'application/octet-stream');res.end(data)});
 }catch(e){json(res,400,{error:e instanceof SyntaxError?'请求内容格式不正确':'操作未完成，请重试'})}});
}
module.exports={createApp};

