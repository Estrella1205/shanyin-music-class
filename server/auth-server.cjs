const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {promisify}=require('node:util');const scrypt=promisify(crypto.scrypt);
/**
 * 数据目录：默认沿用项目外的 .local-data（与历史本机数据保持一致）；
 * 若该位置不可写（如部署沙箱），退回项目内 .local-data。可用 SHANYIN_DATA_DIR 显式指定。
 */
const defaultDataDir = (() => {
  const outside = path.join(__dirname, '..', '..', '.local-data');
  try { fs.mkdirSync(outside, { recursive: true }); fs.accessSync(outside, fs.constants.W_OK); return outside; }
  catch { return path.join(__dirname, '..', '.local-data'); }
})();
function createApp({dataDir=process.env.SHANYIN_DATA_DIR||defaultDataDir,agentAdapter,webSearcher,publicDeploy=false}={}){
 const root=path.join(__dirname,'..','public'),dbFile=path.join(dataDir,'accounts.json');
 /** 离线外壳的版本号 = public/ 全部文件的「路径+大小+修改时间」指纹。
  *  外壳任何一个文件变了，浏览器下次打开就会发现 sw.js 变了 → 重装 → 刷新离线缓存。
  *  否则老师拿到的永远是第一次打开时的旧脚本（这种 bug 极难发现）。 */
 let swStampCache=null;
 const shellStamp=()=>{if(swStampCache)return swStampCache;const h=crypto.createHash('sha256');const walk=dir=>{for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,entry.name);if(entry.isDirectory())walk(p);else{const s=fs.statSync(p);h.update(path.relative(root,p)+'|'+s.size+'|'+Math.floor(s.mtimeMs))}}};walk(root);return (swStampCache=h.digest('hex').slice(0,16))};
 const loadLesson=id=>{const direct=path.join(root,'lessons',`${id}.lesson.json`);if(fs.existsSync(direct))return JSON.parse(fs.readFileSync(direct,'utf8'));/* 兜底：文件名与 lesson.id 不一致（molihua.lesson.json ↔ molihua-opening-v1）时按内部 id 找一遍 */try{for(const file of fs.readdirSync(path.join(root,'lessons')).filter(f=>f.endsWith('.lesson.json'))){const item=JSON.parse(fs.readFileSync(path.join(root,'lessons',file),'utf8'));if(item.id===id)return item}}catch{}return null};
 const audioStoreEarly=require('./audio-store.cjs').createAudioStore(dataDir,{loadLesson});
const agent=require('./teaching-agent.cjs').createAgent({dataDir,adapter:agentAdapter,store:audioStoreEarly,webSearcher,loadLesson});
 const audioStore=audioStoreEarly;
 /* 录音保留期清扫：启动时跑一次，之后每小时一次；unref 保证不阻塞进程退出。 */
 const runSweep=()=>{try{return audioStore.sweepExpired()}catch{return null}};
 runSweep();
 const sweepTimer=setInterval(runSweep,3600000);if(typeof sweepTimer.unref==='function')sweepTimer.unref();
 const reportBuilder=require('./report-builder.cjs');
 const sourcesDir=path.join(__dirname,'..','knowledge','sources');
 const importPipeline=require('./import-pipeline.cjs');
 const courseware=require('./courseware.cjs');
 const difficulty=require('./difficulty.cjs');
 const bioDir=path.join(__dirname,'..','knowledge','biographies');
 const coursewareDir=path.join(dataDir,'courseware');
 /** 来源登记全部读进内存：文件不多，且按 id 索引比按文件名可靠。 */
 const loadSources=()=>{const list=[];for(const file of fs.readdirSync(sourcesDir)){if(!file.endsWith('.source.json'))continue;try{list.push(JSON.parse(fs.readFileSync(path.join(sourcesDir,file),'utf8')))}catch{}}return list};
 /** 导入音频缓存只保留最近 12 份内容哈希目录，避免无限增长。 */
 const pruneImports=()=>{const dir=path.join(dataDir,'imports');const dirs=fs.readdirSync(dir,{withFileTypes:true}).filter(entry=>entry.isDirectory()).map(entry=>path.join(dir,entry.name)).map(entry=>({entry,at:fs.statSync(entry).mtimeMs})).sort((a,b)=>b.at-a.at);for(const old of dirs.slice(12))fs.rmSync(old.entry,{recursive:true,force:true})};
 /** 出去之前把 Buffer 摘掉：音频只以 URL 形式给出，不塞进 JSON。 */
 const serializeImport=result=>({pipelineVersion:result.pipelineVersion,contentKey:result.contentKey,lesson:result.lesson,jianpu:result.jianpu,warnings:result.warnings,difficulty:result.difficulty,plan:result.plan,planSource:result.planSource,licensing:result.licensing,teachingReady:result.teachingReady,steps:result.steps,durationMs:result.durationMs,audio:result.audio?{contentKey:result.audio.contentKey,files:result.audio.variants.map(variant=>({kind:variant.kind,bpm:variant.bpm,countIn:variant.countIn,bytes:variant.bytes,sha256:variant.sha256,durationSeconds:variant.durationSeconds,url:`/api/lesson/imports/${result.audio.contentKey}/${variant.kind}.wav`}))}:null});
 /** 从课件关联的 lesson JSON 里解析参考音频（assets 里的真实文件名，而不是拿 lesson.id 拼名字）。 */
 const lessonAudioAbs=lessonId=>{const lessonData=lessonId?loadLesson(lessonId):null;return lessonData?.audio?.reference?path.join(root,lessonData.audio.reference):null};
 /** 一份课件的全部出口：大屏页、JSON、分镜脚本、合成方案、逐张矢量图、PPTX、成片 MP4。 */
 const coursewareUrls=(id,built)=>({view:`/api/courseware/${id}?format=view`,json:`/api/courseware/${id}`,storyboard:`/api/courseware/${id}?format=storyboard`,storyboardMd:`/api/courseware/${id}?format=md`,video:`/api/courseware/${id}?format=video`,pptx:`/api/courseware/${id}?format=pptx`,renderVideo:`/api/courseware/${id}/render-video`,svg:built.slides.map((slide,index)=>`/api/courseware/${id}?format=svg&n=${index+1}`)});
 fs.mkdirSync(dataDir,{recursive:true});let db={users:[]};if(fs.existsSync(dbFile))db=JSON.parse(fs.readFileSync(dbFile,'utf8'));
 const sessions=new Map(),attempts=new Map();
 const save=()=>{fs.writeFileSync(dbFile+'.tmp',JSON.stringify(db),{mode:0o600});fs.renameSync(dbFile+'.tmp',dbFile)};
 const publicUser=u=>({id:u.id,username:u.username,name:u.name,school:u.school,avatar:u.avatar,role:u.role||'teacher'});
 const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data))};
 const cookie=(res,token,maxAge=43200)=>res.setHeader('Set-Cookie',`srsy_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}`);
 const tokenOf=req=>(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('srsy_session='))?.slice(13);
 /** 登录限流的计数键：公网模式下所有人经同一反向代理进来，remoteAddress 全是 127.0.0.1，
  *  必须改读 X-Forwarded-For 的第一跳，否则会变成"全站共用 30 次额度"。 */
 const clientKey=req=>{const xff=String(req.headers['x-forwarded-for']||'').split(',')[0].trim();return (publicDeploy&&xff)||req.socket.remoteAddress||'unknown'};
 const userOf=req=>{const token=tokenOf(req),session=sessions.get(token);if(!session)return null;if(session.expires<Date.now()){sessions.delete(token);return null}return db.users.find(u=>u.id===session.id)};
 async function body(req,limit=350000){let size=0,parts=[];for await(const part of req){size+=part.length;if(size>limit)throw new Error('请求内容过大');parts.push(part)}return JSON.parse(Buffer.concat(parts).toString()||'{}')}
 async function hash(password,salt){return (await scrypt(password,salt,64)).toString('hex')}
 /* ---- 账号找回：恢复码 ----
  * 乡村老师没有邮箱、也不一定绑手机，所以找回只能靠"注册时发一枚一次性恢复码"。
  * 码只存哈希（与密码同一套 scrypt 参数），只在发放的那一刻明文出现一次；
  * 用过一次立刻换新的 —— 旧码当场失效，避免"抄在备课本上的那张纸"被人捡到后反复可用。 */
 const RECOVERY_ALPHABET='ABCDEFGHJKMNPQRSTVWXYZ23456789';   // 去掉 I L O U，免得手抄时和 1 0 混淆
 const normalizeRecoveryCode=value=>String(value??'').toUpperCase().replace(/[^0-9A-Z]/g,'');
 const newRecoveryCode=()=>{const out=[];while(out.length<16){for(const byte of crypto.randomBytes(32)){if(byte>=240)continue;out.push(RECOVERY_ALPHABET[byte%30]);if(out.length===16)break}}return out.join('').replace(/(.{4})(?=.)/g,'$1-')};
 /** 生成并保存一枚新恢复码，返回明文（调用方负责只显示这一次）。 */
 async function setRecoveryCode(u){const code=newRecoveryCode(),salt=crypto.randomBytes(16).toString('hex');u.recovery={salt,hash:await hash(normalizeRecoveryCode(code),salt),createdAt:new Date().toISOString()};save();return code}
 function issue(req,res,u){sessions.delete(tokenOf(req));const token=crypto.randomBytes(32).toString('hex');sessions.set(token,{id:u.id,expires:Date.now()+43200000});cookie(res,token)}
 return http.createServer(async(req,res)=>{res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');
 try{const route=new URL(req.url,'http://localhost').pathname;
 if(route.startsWith('/api/')){
  // 本机演示默认只认 127.0.0.1/localhost；公网部署时由反向代理带来真实域名，必须放行。
  if(!publicDeploy&&!/^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(req.headers.host||''))return json(res,403,{error:'仅允许本机访问'});
  if(req.method!=='GET'){
   // 只比对"主机:端口"，不比对协议。
   // 公网模式下反向代理给出的 Host / X-Forwarded-Host 都是内部地址，无法还原对外域名，
   // 等值比对必然误杀，因此不做；跨域防护改由自定义头 X-Shengru-Client + SameSite=Strict
   // 承担 —— 浏览器跨域请求无法在不经预检的情况下带上自定义头，而本服务不发放 CORS 许可。
   if(!publicDeploy){
    const originHost=(req.headers.origin||'').replace(/^https?:\/\//,'').replace(/\/+$/,'');
    if(originHost&&originHost!==req.headers.host)return json(res,403,{error:'请求来源不匹配'});
   }
   if(req.headers['x-shengru-client']!=='local-web')return json(res,403,{error:'请求校验失败'});
   if(!req.headers['content-type']?.startsWith('application/json'))return json(res,415,{error:'需要 JSON 请求'});
  }
  const user=userOf(req);
  if(route==='/api/session'&&req.method==='GET')return json(res,200,{user:user?publicUser(user):null,state:user?.state||null,policy:{audioRetentionDays:audioStore.retentionDays}});
  if((route==='/api/register'||route==='/api/login')&&req.method==='POST'){
   const key=clientKey(req);let rate=attempts.get(key);if(!rate||rate.until<Date.now()){rate={n:0,until:Date.now()+900000};attempts.set(key,rate)}if(++rate.n>30)return json(res,429,{error:'尝试次数过多，请15分钟后再试'});
   const b=await body(req),username=String(b.username||'').trim().toLowerCase(),password=String(b.password||'');
   if(!/^[a-z0-9_.-]{3,32}$/.test(username)||password.length<8||password.length>128)return json(res,400,{error:'账号需为3–32位英文、数字或._-，密码需为8–128位'});
   const role=b.role==='student'?'student':'teacher';
   let u=db.users.find(x=>x.username===username);let recoveryCode=null;
   if(route==='/api/register'){
    if(u)return json(res,409,{error:'这个账号已注册，请登录或更换账号'});
    const name=String(b.name||'').trim();if(!name||name.length>20)return json(res,400,{error:role==='student'?'请填写1–20字的称呼或昵称':'请填写1–20字的教师称呼'});
    const salt=crypto.randomBytes(16).toString('hex'),passwordHash=await hash(password,salt);
    if(db.users.some(x=>x.username===username))return json(res,409,{error:'这个账号已注册'});
    u={id:crypto.randomUUID(),username,name,school:'',avatar:role==='student'?'🧒': '🧑🏻‍🏫',role,salt,passwordHash,state:null};db.users.push(u);save();
    recoveryCode=await setRecoveryCode(u);   // 注册即发码：不然"忘了密码"这条路一开始就不通
   }else{
    const candidate=await hash(password,u?.salt||'invalid-user-salt');
    if(!u||!crypto.timingSafeEqual(Buffer.from(candidate,'hex'),Buffer.from(u.passwordHash,'hex')))return json(res,401,{error:'账号或密码不正确'});
   }
   issue(req,res,u);return json(res,200,{user:publicUser(u),state:u.state,...(recoveryCode?{recoveryCode}:{})});
  }
  // 忘了密码：用恢复码重设。用完立即换新码，旧码当场失效。
  if(route==='/api/recover'&&req.method==='POST'){
   const rateKey='recover:'+clientKey(req);let rate=attempts.get(rateKey);if(!rate||rate.until<Date.now()){rate={n:0,until:Date.now()+900000};attempts.set(rateKey,rate)}if(++rate.n>10)return json(res,429,{error:'尝试次数过多，请15分钟后再试'});
   const b=await body(req),username=String(b.username||'').trim().toLowerCase(),code=normalizeRecoveryCode(b.code),password=String(b.password||'');
   if(!username||!code||password.length<8||password.length>128)return json(res,400,{error:'请填写账号、恢复码与新密码（新密码需8–128位）'});
   const u=db.users.find(x=>x.username===username);
   if(!u?.recovery)return json(res,400,{error:'这个账号没有可用的恢复码：请用原密码登录后，在「个人资料 · 账号找回」里生成一枚；若原密码也忘了，只能重新注册一个账号'});
   const candidate=await hash(code,u.recovery.salt);
   if(!crypto.timingSafeEqual(Buffer.from(candidate,'hex'),Buffer.from(u.recovery.hash,'hex')))return json(res,401,{error:'账号或恢复码不正确'});
   u.salt=crypto.randomBytes(16).toString('hex');u.passwordHash=await hash(password,u.salt);
   for(const [k,v] of sessions)if(v.id===u.id)sessions.delete(k);
   const recoveryCode=await setRecoveryCode(u);
   issue(req,res,u);return json(res,200,{user:publicUser(u),state:u.state,recoveryCode});
  }
  if(route==='/api/logout'&&req.method==='POST'){sessions.delete(tokenOf(req));cookie(res,'',0);return json(res,200,{ok:true})}
  // 山野简谱文本导入（方案 §4.2 / §4.4）：不依赖任何外部谱源，老师手抄什么就录什么。
  // 不写用户数据、不依赖登录态 —— 老师可以先试录一遍，再决定要不要拿它上课。
  if(route==='/api/lesson/import-jianpu'&&req.method==='POST'){
   try{
    const payload=await body(req,2000000);
    // 谱面文件（MusicXML / MIDI）：先转成山野简谱文本，再走与手抄导入完全相同的流水线。
    const f=payload.file;
    if(f&&String(f.data??'').length>1500000)return json(res,400,{error:'谱面文件过大，一期只支持单乐段（约 1MB 以内）',steps:[]});
    const result=await importPipeline.runImport({
     text:payload.text,
     file:f?{kind:f.kind,data:f.data,fileName:f.fileName,mimeType:f.mimeType,title:f.title,bpm:f.bpm,sourceId:f.sourceId}:null,
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
  return json(res,200,{biographies:courseware.loadBiographies(bioDir).map(bio=>({id:bio.id,title:bio.title,subtitle:bio.subtitle??'',kind:bio.kind,tags:bio.tags??[],linkedLessonIds:bio.linkedLessonIds??[],facts:(bio.facts??[]).length,activities:(bio.activities??[]).length,verified:Boolean(bio.verifiedBy),reviewNote:bio.reviewNote??null})),lessons,ffmpeg:courseware.detectFfmpeg(),edge:courseware.detectEdge()});
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
   return json(res,200,{...built,id,urls:coursewareUrls(id,built),videoEnv:{ffmpeg:courseware.detectFfmpeg().available,edge:courseware.detectEdge().available}});
  }catch(e){return json(res,e.statusCode||400,{error:e.message||'课件未生成'})}
 }
 const coursewareRenderRoute=route.match(/^\/api\/courseware\/([a-f0-9]{24})\/render-video$/);
 if(coursewareRenderRoute&&req.method==='POST'){
  const id=coursewareRenderRoute[1],file=path.join(coursewareDir,`${id}.json`);
  if(!fs.existsSync(file))return json(res,404,{error:'这份课件不在缓存里了，请重新生成一次'});
  const edge=courseware.detectEdge(),ff=courseware.detectFfmpeg();
  if(!edge.available)return json(res,400,{error:'没有检测到 Microsoft Edge，无法把幻灯片截成图片',hint:edge.hint});
  if(!ff.available)return json(res,400,{error:'没有检测到 ffmpeg，无法合成 MP4',hint:ff.hint});
  try{
   const built=JSON.parse(fs.readFileSync(file,'utf8'));
   const audio=lessonAudioAbs(built.lesson?.id);
   const done=await courseware.renderVideo({built,outDir:path.join(coursewareDir,id),audioFile:audio,edgePath:edge.path,ffmpegPath:ff.command});
   return json(res,200,{ok:true,mp4:`/api/courseware/${id}?format=mp4`,shots:done.shots,seconds:done.seconds});
  }catch(e){return json(res,e.statusCode||500,{error:e.message||'视频合成失败'})}
 }
 const coursewareRoute=route.match(/^\/api\/courseware\/([a-f0-9]{24})$/);
 if(coursewareRoute&&req.method==='GET'){
  const id=coursewareRoute[1],file=path.join(coursewareDir,`${id}.json`);
  if(!fs.existsSync(file))return json(res,404,{error:'这份课件不在缓存里了，请重新生成一次'});
  const built=JSON.parse(fs.readFileSync(file,'utf8')),params=new URL(req.url,'http://local').searchParams,format=params.get('format')||'json';
  if(format==='view'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});return res.end(courseware.renderSlidesHtml(built))}
  if(format==='storyboard')return json(res,200,courseware.buildStoryboard(built));
  if(format==='md'){const story=courseware.buildStoryboard(built);res.writeHead(200,{'Content-Type':'text/markdown; charset=utf-8','Content-Disposition':`attachment; filename="storyboard-${id}.md"`});return res.end(courseware.storyboardMarkdown(story))}
  if(format==='video'){const story=courseware.buildStoryboard(built);const audioRel=built.lesson?(loadLesson(built.lesson.id)?.audio?.reference||null):null;return json(res,200,{ffmpeg:courseware.detectFfmpeg(),edge:courseware.detectEdge(),totalSeconds:story.totalSeconds,shots:story.shots.length,script:courseware.renderFfmpegScript(story,{audioFile:audioRel?`public/${audioRel}`:null})})}
  if(format==='mp4'){const mp4=path.join(coursewareDir,id,'courseware.mp4');if(!fs.existsSync(mp4))return json(res,404,{error:'这份课件还没有合成视频，请先在课件页点「合成 MP4 视频」'});res.writeHead(200,{'Content-Type':'video/mp4','Content-Disposition':`attachment; filename="courseware-${id}.mp4"`,'Cache-Control':'no-store'});return res.end(fs.readFileSync(mp4))}
  if(format==='pptx'){res.writeHead(200,{'Content-Type':'application/vnd.openxmlformats-officedocument.presentationml.presentation','Content-Disposition':`attachment; filename="courseware-${id}.pptx"`,'Cache-Control':'no-store'});return res.end(courseware.buildPptx(built))}
  if(format==='svg'){const n=Math.max(1,Math.min(built.slides.length,Number(params.get('n')||1)));res.writeHead(200,{'Content-Type':'image/svg+xml; charset=utf-8','Cache-Control':'no-store'});return res.end(courseware.renderSlideSvg(built.slides[n-1],{index:n,total:built.slides.length,courseware:built}))}
  return json(res,200,{...built,urls:coursewareUrls(id,built)});
 }
 if(!user)return json(res,401,{error:'请先登录'});
  if(route==='/api/audio/attempts'&&req.method==='GET')return json(res,200,{attempts:audioStore.list(user.id)});
  if(route==='/api/audio/attempts'&&req.method==='POST'){try{return json(res,201,await audioStore.submit(user.id,await body(req,900000)))}catch(e){return json(res,400,{error:e.message,hint:e.hint||null})}}
  const audioRoute=route.match(/^\/api\/audio\/attempts\/([a-f0-9-]{36})(?:\/(wav|practice))?$/);
  if(audioRoute){const [,id,action]=audioRoute;if(action==='practice'&&req.method==='POST'){try{return json(res,200,audioStore.practice(id,user.id))}catch{return json(res,404,{error:'录音不存在'})}}if(req.method==='GET'){const r=audioStore.get(id,user.id);if(!r)return json(res,404,{error:'录音不存在'});if(action==='wav'){if(r.audioDeleted)return json(res,410,{error:'录音音频已按保留策略自动删除',hint:`录音音频保留 ${r.retentionDays??audioStore.retentionDays} 天后自动删除；测量与诊断结果不受影响`});const wav=audioStore.audio(id,user.id);if(!wav)return json(res,410,{error:'录音音频文件缺失'});res.writeHead(200,{'Content-Type':'audio/wav','Cache-Control':'no-store'});return res.end(wav)}return json(res,200,r)}}
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
   const role=user.role||'teacher';
   const avatarSets={teacher:['🧑🏻‍🏫','👩🏻‍🏫','👨🏻‍🏫','🧑🏻‍🌾','👩🏻‍🎨'],student:['🧒','👧','👦','🧑','👶']};
   if(!avatarSets[role].includes(b.avatar))return json(res,400,{error:'请选择提供的头像'});
   Object.assign(user,{name,school,avatar:b.avatar});save();return json(res,200,{user:publicUser(user)});
  }
  // 登录后重新发一枚恢复码：旧码立刻失效。忘记密码前没保存过码的老师也能在这里补一枚。
  if(route==='/api/recover/code'&&req.method==='POST')return json(res,200,{recoveryCode:await setRecoveryCode(user)});
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
 // 离线脚本：版本号注入外壳指纹，外壳一变浏览器就会自动刷新离线缓存。
 if(pathname==='/sw.js'){
  try{const source=fs.readFileSync(file,'utf8');res.writeHead(200,{'Content-Type':'text/javascript; charset=utf-8','Cache-Control':'no-cache'});return res.end(source.split('__BUILD__').join(shellStamp()))}
  catch{return json(res,404,{error:'离线脚本缺失'})}
 }
 fs.readFile(file,(err,data)=>{if(err){res.writeHead(404);res.end('Not found');return}res.setHeader('Cache-Control','no-cache');res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.png':'image/png','.wav':'audio/wav','.json':'application/json; charset=utf-8'})[path.extname(file)]||'application/octet-stream');res.end(data)});
 }catch(e){json(res,400,{error:e instanceof SyntaxError?'请求内容格式不正确':'操作未完成，请重试'})}});
}
module.exports={createApp};

