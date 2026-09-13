const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {promisify}=require('node:util');const scrypt=promisify(crypto.scrypt);
function createApp({dataDir=path.join(__dirname,'..','../.local-data'),agentAdapter}={}){
 const audioStoreEarly=require('./audio-store.cjs').createAudioStore(dataDir);
const agent=require('./teaching-agent.cjs').createAgent({dataDir,adapter:agentAdapter,store:audioStoreEarly});
 const audioStore=audioStoreEarly;
 const reportBuilder=require('./report-builder.cjs');
 const sourcesDir=path.join(__dirname,'..','knowledge','sources');
 const importPipeline=require('./import-pipeline.cjs');
 const courseware=require('./courseware.cjs');
 const difficulty=require('./difficulty.cjs');
 const bioDir=path.join(__dirname,'..','knowledge','biographies');
 const coursewareDir=path.join(dataDir,'courseware');
 const root=path.join(__dirname,'..','public'),dbFile=path.join(dataDir,'accounts.json');
 /** 来源登记全部读进内存：文件不多，且按 id 索引比按文件名可靠。 */
 const loadSources=()=>{const list=[];for(const file of fs.readdirSync(sourcesDir)){if(!file.endsWith('.source.json'))continue;try{list.push(JSON.parse(fs.readFileSync(path.join(sourcesDir,file),'utf8')))}catch{}}return list};
 /** 导入音频缓存只保留最近 12 份内容哈希目录，避免无限增长。 */
 const pruneImports=()=>{const dir=path.join(dataDir,'imports');const dirs=fs.readdirSync(dir,{withFileTypes:true}).filter(entry=>entry.isDirectory()).map(entry=>path.join(dir,entry.name)).map(entry=>({entry,at:fs.statSync(entry).mtimeMs})).sort((a,b)=>b.at-a.at);for(const old of dirs.slice(12))fs.rmSync(old.entry,{recursive:true,force:true})};
 /** 出去之前把 Buffer 摘掉：音频只以 URL 形式给出，不塞进 JSON。 */
 const serializeImport=result=>({pipelineVersion:result.pipelineVersion,contentKey:result.contentKey,lesson:result.lesson,jianpu:result.jianpu,warnings:result.warnings,difficulty:result.difficulty,plan:result.plan,planSource:result.planSource,licensing:result.licensing,teachingReady:result.teachingReady,steps:result.steps,durationMs:result.durationMs,audio:result.audio?{contentKey:result.audio.contentKey,files:result.audio.variants.map(variant=>({kind:variant.kind,bpm:variant.bpm,countIn:variant.countIn,bytes:variant.bytes,sha256:variant.sha256,durationSeconds:variant.durationSeconds,url:`/api/lesson/imports/${result.audio.contentKey}/${variant.kind}.wav`}))}:null});
 const loadLesson=id=>{const file=path.join(root,'lessons',`${id}.lesson.json`);return fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):null};
 /** 一份课件的全部出口：大屏页、JSON、分镜脚本、合成方案、逐张矢量图。 */
 const coursewareUrls=(id,built)=>({view:`/api/courseware/${id}?format=view`,json:`/api/courseware/${id}`,storyboard:`/api/courseware/${id}?format=storyboard`,storyboardMd:`/api/courseware/${id}?format=md`,video:`/api/courseware/${id}?format=video`,svg:built.slides.map((slide,index)=>`/api/courseware/${id}?format=svg&n=${index+1}`)});
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
  // 山野简谱文本导入（方案 §4.2 / §4.4）：不依赖任何外部谱源，老师手抄什么就录什么。
  // 不写用户数据、不依赖登录态 —— 老师可以先试录一遍，再决定要不要拿它上课。
  if(route==='/api/lesson/import-jianpu'&&req.method==='POST'){
   try{
    const payload=await body(req,200000);
    const result=await importPipeline.runImport({
     text:payload.text,
     options:{id:payload.id,title:payload.title,sourceId:payload.sourceId,description:payload.description},
     planParams:{...(payload.planParams||payload.params||{})},
     sources:loadSources(),
     asOf:payload.asOf,
    });
    // 合成好的音频按**内容哈希**缓存：同一份谱子重复导入不会重复合成；内容寻址，不涉及任何用户数据。
    if(result.audio){
     const dir=path.join(dataDir,'imports',result.audio.contentKey);fs.mkdirSync(dir,{recursive:true});
     for(const variant of result.audio.variants)fs.writeFileSync(path.join(dir,`${variant.kind}.wav`),variant.buffer);
     pruneImports();
    }
    return json(res,200,serializeImport(result));
   }catch(e){
    if(e.name==='JianpuError')return json(res,400,{error:e.reason,line:e.line,column:e.column,raw:e.raw,message:e.message,steps:e.steps||[]});
    return json(res,400,{error:e.message==='请求内容过大'?'文本过长，请只保留一段乐谱':(e.message||'导入未完成'),steps:e.steps||[]});
   }
  }
  const importAudio=route.match(/^\/api\/lesson\/imports\/([a-f0-9]{32})\/(reference|slow|countIn)\.wav$/);
  if(importAudio&&req.method==='GET'){
   const [,key,kind]=importAudio,file=path.join(dataDir,'imports',key,`${kind}.wav`);
   if(!fs.existsSync(file))return json(res,404,{error:'这份参考音频不在缓存里，请重新导入一次'});
   res.writeHead(200,{'Content-Type':'audio/wav','Cache-Control':'no-store','Content-Disposition':`inline; filename="import-${kind}.wav"`});
   return res.end(fs.readFileSync(file));
  }
  // 音乐家生平 → 课件／视频（方案 §5）。材料与来源都在本仓库内，读操作同样不依赖登录态。
 if(route==='/api/courseware'&&req.method==='GET'){
  const lessons=fs.readdirSync(path.join(root,'lessons')).filter(file=>file.endsWith('.lesson.json')).map(file=>{const item=JSON.parse(fs.readFileSync(path.join(root,'lessons',file),'utf8'));return {id:item.id,title:item.title}});
  return json(res,200,{biographies:courseware.loadBiographies(bioDir).map(bio=>({id:bio.id,title:bio.title,subtitle:bio.subtitle??'',kind:bio.kind,tags:bio.tags??[],linkedLessonIds:bio.linkedLessonIds??[],facts:(bio.facts??[]).length,activities:(bio.activities??[]).length,verified:Boolean(bio.verifiedBy),reviewNote:bio.reviewNote??null})),lessons,ffmpeg:courseware.detectFfmpeg()});
 }
 if(route==='/api/courseware/build'&&req.method==='POST'){
  try{
   const payload=await body(req,100000);
   const lesson=payload.lessonId?loadLesson(payload.lessonId):null;
   const built=courseware.buildCourseware({
    bios:courseware.loadBiographies(bioDir),
    sources:loadSources(),
    lesson,
    difficulty:lesson?difficulty.analyze(lesson):null,
    options:{bioIds:payload.bioIds,theme:payload.theme,teacher:payload.teacher,school:payload.school},
    asOf:payload.asOf,
   });
   const id=courseware.coursewareId(built);
   fs.mkdirSync(coursewareDir,{recursive:true});
   fs.writeFileSync(path.join(coursewareDir,`${id}.json`),JSON.stringify({...built,id}));
   return json(res,200,{...built,id,urls:coursewareUrls(id,built)});
  }catch(e){return json(res,e.statusCode||400,{error:e.message||'课件未生成'})}
 }
 const coursewareRoute=route.match(/^\/api\/courseware\/([a-f0-9]{24})$/);
 if(coursewareRoute&&req.method==='GET'){
  const id=coursewareRoute[1],file=path.join(coursewareDir,`${id}.json`);
  if(!fs.existsSync(file))return json(res,404,{error:'这份课件不在缓存里了，请重新生成一次'});
  const built=JSON.parse(fs.readFileSync(file,'utf8')),params=new URL(req.url,'http://local').searchParams,format=params.get('format')||'json';
  if(format==='view'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});return res.end(courseware.renderSlidesHtml(built))}
  if(format==='storyboard')return json(res,200,courseware.buildStoryboard(built));
  if(format==='md'){const story=courseware.buildStoryboard(built);res.writeHead(200,{'Content-Type':'text/markdown; charset=utf-8','Content-Disposition':`attachment; filename="storyboard-${id}.md"`});return res.end(courseware.storyboardMarkdown(story))}
  if(format==='video'){const story=courseware.buildStoryboard(built);return json(res,200,{ffmpeg:courseware.detectFfmpeg(),totalSeconds:story.totalSeconds,shots:story.shots.length,script:courseware.renderFfmpegScript(story,{audioFile:built.lesson?`public/assets/audio/${built.lesson.id}-c-80.wav`:null})})}
  if(format==='svg'){const n=Math.max(1,Math.min(built.slides.length,Number(params.get('n')||1)));res.writeHead(200,{'Content-Type':'image/svg+xml; charset=utf-8','Cache-Control':'no-store'});return res.end(courseware.renderSlideSvg(built.slides[n-1],{index:n,total:built.slides.length,courseware:built}))}
  return json(res,200,{...built,urls:coursewareUrls(id,built)});
 }
 if(!user)return json(res,401,{error:'请先登录'});
  if(route==='/api/audio/attempts'&&req.method==='GET')return json(res,200,{attempts:audioStore.list(user.id)});
  if(route==='/api/audio/attempts'&&req.method==='POST'){try{return json(res,201,await audioStore.submit(user.id,await body(req,900000)))}catch(e){return json(res,400,{error:e.message,hint:e.hint||null})}}
  const audioRoute=route.match(/^\/api\/audio\/attempts\/([a-f0-9-]{36})(?:\/(wav|practice))?$/);
  if(audioRoute){const [,id,action]=audioRoute;if(action==='practice'&&req.method==='POST'){try{return json(res,200,audioStore.practice(id,user.id))}catch{return json(res,404,{error:'录音不存在'})}}if(req.method==='GET'){const r=action==='wav'?audioStore.audio(id,user.id):audioStore.get(id,user.id);if(!r)return json(res,404,{error:'录音不存在'});if(action==='wav'){res.writeHead(200,{'Content-Type':'audio/wav','Cache-Control':'no-store'});return res.end(r)}return json(res,200,r)}}
  if(route==='/api/reports/overview'&&req.method==='GET')return json(res,200,reportBuilder.buildReport(user.id,audioStore.list(user.id)));
  if(route==='/api/agent/status'&&req.method==='GET')return json(res,200,{configured:agent.configured});
  if(route==='/api/agent/tasks'&&req.method==='GET')return json(res,200,{tasks:agent.list(user.id)});
  if(route==='/api/agent/tasks'&&req.method==='POST'){
   try{return json(res,202,agent.start(user.id,await body(req)))}catch(e){return json(res,e.message==='AGENT_BUSY'?429:400,{error:({MODEL_NOT_CONFIGURED:'服务端尚未配置 TEACHING_API_KEY 和 TEACHING_MODEL',AGENT_BUSY:'已有任务运行中，请稍后重试',UNSUPPORTED_LESSON:'真实教学 Agent 当前仅支持已校对的《茉莉花》'})[e.message]||'请检查课堂需求与条件'})}
  }
  if(route==='/api/agent/coaching-tasks'&&req.method==='POST'){
   try{return json(res,202,agent.startCoaching(user.id,await body(req)))}catch(e){return json(res,e.message==='AGENT_BUSY'?429:404,{error:({AGENT_BUSY:'已有任务运行中，请稍后重试',ATTEMPT_NOT_FOUND:'找不到这条录音测量',INVALID_REQUEST:'缺少有效的录音编号',STORE_UNAVAILABLE:'服务端未启用录音存储'})[e.message]||'操作未完成'})}
  }
  if(route==='/api/agent/class-report-tasks'&&req.method==='POST'){
   try{return json(res,202,agent.startClassReport(user.id))}catch(e){return json(res,e.message==='AGENT_BUSY'?429:400,{error:e.message==='AGENT_BUSY'?'已有任务运行中，请稍后重试':'操作未完成'})}
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

