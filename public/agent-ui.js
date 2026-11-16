/* 备课过程只呈现一朵慢慢长大的小花：真实完成度照常驱动画面，
   服务端事件、原始 JSON、任务与模型标识、来源链接、免责说明一律不进课堂界面。 */
const templatePrepare=prepare,templatePrep=prepWorkspace,templateAgentPanel=agentPanel,verifiedApply=applyVerifiedPlan,agentBaseRender=render,agentBaseMake=makePlan;
let activeAgentTask=null;
applyVerifiedPlan=function(reset){if(state.agentPlan&&!reset)return;return verifiedApply(reset)};
makePlan=function(){delete state.agentPlan;delete state.agentTaskId;activeAgentTask=null;window.GrowProgress?.reset('prep');return agentBaseMake()};

/* 出错只说人话，不把错误码、模型名、配置项摆到老师面前。 */
function agentErrorText(code){return ({
  PLAN_UNSUPPORTED_LESSON:'这首歌的教案还在准备中，可以先到「曲库课堂」挑一首～',
  PLAN_DURATION_INVALID:'环节时间没排拢，再试一次就好啦～',
  AGENT_VALIDATION_FAILED:'这次没通过检查，再来一次吧～',
  AGENT_CANCELLED:'这次先停下了，随时可以重新开始～',
}[code]||'这节课一时没准备好，稍等一下再试一次～')}

/* 五个真实教学阶段，说成小朋友也听得懂的话。 */
const PREP_STAGES=['听清今天想上什么课','翻出这首歌的小档案','把要用的材料找齐','把课堂环节排成一条线','最后检查一遍，刚刚好'];
const PREP_STAGE_INDEX={'需求解析':0,'教学资料检索':1,'互联网资料检索':2,'教案规划':3,'输出可执行活动':4};
const FUN_WAIT=['🌱 小种子刚睡醒，伸了个懒腰……','☀️ 阳光暖暖的，再等一小会儿～','🍃 小叶子正在慢慢舒展……','🌼 花苞鼓起来了，快啦快啦！','🦋 蝴蝶也飞过来等着看花开……'];
let funTimer=null,funIdx=0;
function stopFunTicker(){if(funTimer){clearTimeout(funTimer);funTimer=null}}
function ensureFunTicker(){
  stopFunTicker();
  const step=()=>{
    const lines=[...document.querySelectorAll('[data-gp-caption]')];
    if(!lines.length){funTimer=null;return}
    const text=FUN_WAIT[funIdx++%FUN_WAIT.length];
    lines.forEach(el=>{el.textContent=text});
    funTimer=setTimeout(step,2600);
  };
  funTimer=setTimeout(step,80);
}
/* 完成度只取服务端真实完成的阶段，绝不为了好看虚报进度。 */
function prepDone(t){
  if(t.status==='completed')return PREP_STAGES.length;
  let n=0;
  (t.events||[]).forEach(e=>{const i=PREP_STAGE_INDEX[e.stage];if(i!==undefined&&e.status==='completed')n=Math.max(n,i+1)});
  return Math.min(PREP_STAGES.length,n);
}
function taskCard(t){
  const running=t.status==='running',done=t.status==='completed',paused=!running&&!done;
  const n=prepDone(t),stateName=running?'running':(done?'done':'paused');
  const caption=running?FUN_WAIT[Math.min(FUN_WAIT.length-1,n)]:(done?'花开啦！这节课已经准备好～':'小花先歇一会儿，随时可以再来一次～');
  const card=window.GrowProgress?window.GrowProgress.html({
    key:'prep',stages:PREP_STAGES,done:n,state:stateName,caption,
    title:done?'准备好啦，开花啦！':paused?'先歇一小会儿～':'正在为你准备这节课',
    subtitle:done?'小花完完整整地开好啦，可以开始上课了':paused?'随时可以再来一次，不着急':'每一个环节都在认真长出来～',
  }):'<div class="panel">正在准备这节课…</div>';
  const gentle=paused?`<p class="gp-gentle">${esc(agentErrorText(t.error))}</p>`:'';
  const actions=running?`<div class="panel-actions"><button class="btn secondary" data-agent-cancel="${esc(t.id)}">先不准备了</button></div>`
    :paused?`<div class="panel-actions"><button class="btn" data-agent-retry="${esc(t.id)}">再试一次 🌱</button></div>`:'';
  return `<section class="panel gp-panel">${card}${gentle}${actions}</section>`;
}
/* 右侧原本是面向开发核对的资料审计栏，换成老师上课真正用得上的小锦囊。 */
function tipsPanel(){
  const song=esc(state.song||'这首歌'),grade=esc(state.grade||'同学们');
  const students=esc(String(state.students||'—')),duration=esc(String(state.duration||'—'));
  return `<aside class="panel gp-tips"><h2>🍀 上课小锦囊</h2>
    <div class="gp-tip-row"><span>今天唱</span><b>${song}</b></div>
    <div class="gp-tip-row"><span>给谁上</span><b>${grade} · ${students} 位同学</b></div>
    <div class="gp-tip-row"><span>多长时间</span><b>${duration} 分钟</b></div>
    <h3>三个小提醒</h3>
    <ul>
      <li>🎧 先让大家完整听一遍，再开口唱。</li>
      <li>🎵 一句一句慢慢来，唱顺了再连起来。</li>
      <li>👏 唱完别忘了给自己鼓鼓掌！</li>
    </ul>
  </aside>`;
}
prepWorkspace=function(){
  if(!activeAgentTask)return templatePrep();
  return `<main class="page prep-page">${heading('课前准备','一起把这节课备好','写一句想上的课，剩下的交给小花慢慢长出来 🌱')}
  <div class="prep-grid">${conditionPanel()}${taskCard(activeAgentTask)}${tipsPanel()}</div>
  <div class="prep-actions">${activeAgentTask.status==='completed'?button('看看这节课怎么上','timeline'):''}${!busy?button('重新备一次','prepare','secondary'):''}</div></main>`;
};
agentPanel=function(done){return state.agentPlan&&activeAgentTask?taskCard(activeAgentTask):templateAgentPanel(done)};
/* 首页的技术提示与调试入口、课堂环节里的开发调试按钮都不再出现。 */
render=function(){agentBaseRender()};
async function watchAgent(id,owner){
  let task;
  do{
    task=await api('agent/tasks/'+id);
    if(currentUser?.id!==owner)return;
    activeAgentTask=task;busy=task.status==='running';
    if(task.status==='completed'){
      const r=task.result;
      Object.assign(state,r.requirements,{request:state.request,plan:r.plan,agentPlan:true,agentTaskId:id,stage:0,analysis:null,attempt:0});
      state.lessonReference={id:r.lessonId,version:r.lessonVersion,grouping:'按课堂活动方案组织学生'};
      persist();
    }
    render();
    if(busy)await new Promise(r=>setTimeout(r,1200));
  }while(task.status==='running');
  busy=false;
  if(task.status==='failed')toast('这次没准备好，点「再试一次」就好啦～');
  if(task.status==='cancelled')toast('先停下来啦，随时可以重新开始～');
}
prepare=async function(){
  if(busy)return;
  state.request=$('#request')?.value??state.request;parseRequest();
  const agentLesson=state.song==='茉莉花'?'molihua-opening-v1':state.song==='两只老虎'?'liangzhilaohu-v1':null;
  if(!agentLesson){activeAgentTask=null;delete state.agentPlan;return templatePrepare()}
  if(!currentUser)return toast('刷新一下页面，马上就好～');
  const owner=currentUser.id;
  try{
    const defaults=Object.fromEntries(['song','grade','students','duration','level','equipment'].map(k=>[k,state[k]]));
    defaults.students=Number(defaults.students);defaults.duration=Number(defaults.duration);
    const task=await api('agent/tasks','POST',{request:state.request||`为${state.grade}${state.students}人准备${state.duration}分钟《${state.song}》课，${state.level}，${state.equipment}`,defaults,lessonId:agentLesson});
    window.GrowProgress?.reset('prep');
    activeAgentTask=task;busy=true;state.tab='plan';if(!state.plan)state.plan=[];go('classroom');
    await watchAgent(task.id,owner);
  }catch(e){busy=false;toast('这节课一时没准备好，稍等一下再试一次～');render()}
};
document.addEventListener('click',async e=>{
  const tool=e.target.closest('[data-agent-tool]')?.dataset.agentTool;
  if(tool){
    if(tool==='reference')playReference();
    if(tool==='slow-reference')playReference(true);
    if(tool==='countin')playReference(false,true);
    if(tool==='metronome')metronome();
  }
  const cancelId=e.target.closest('[data-agent-cancel]')?.dataset.agentCancel;
  if(cancelId){
    try{activeAgentTask=await api('agent/tasks/'+cancelId+'/cancel','POST',{});busy=false;render();toast('先停下来啦，随时可以重新开始～')}
    catch(err){toast('稍等一下再试～')}
    return;
  }
  const retryId=e.target.closest('[data-agent-retry]')?.dataset.agentRetry;
  if(retryId){
    if(!currentUser)return toast('刷新一下页面，马上就好～');
    if(busy)return toast('小花还在长呢，等它一下下～');
    try{
      const fresh=await api('agent/tasks/'+retryId+'/retry','POST',{});
      window.GrowProgress?.reset('prep');
      activeAgentTask=fresh;busy=true;state.tab='plan';if(!state.plan)state.plan=[];go('classroom');
      await watchAgent(fresh.id,currentUser.id);
    }catch(err){busy=false;toast('再等一下下，马上就好～');render()}
    return;
  }
});
const unsafeAgentRender=render,legacyTeach=teach,legacyMetronome=metronome;
render=function(){
  if(activeAgentTask&&activeAgentTask.owner!==currentUser?.id)activeAgentTask=null;
  const oldPlan=state.plan,oldGrade=state.grade;
  if(state.agentPlan){state.plan=oldPlan.map(a=>({...a,title:esc(a.title),desc:esc(a.desc)}));state.grade=esc(oldGrade)}
  try{unsafeAgentRender()}finally{if(state.agentPlan){state.plan=oldPlan;state.grade=oldGrade}}
  /* 趣味轮播只在备课进行中跑；结束或离开页面立即停，免得覆盖完成文案或串到别的模块。 */
  if(activeAgentTask?.status==='running'&&document.querySelector('.gp-panel [data-gp-caption]'))ensureFunTicker();
  else stopFunTicker();
  window.GrowProgress?.sync();
};
teach=function(){if(!state.agentPlan)return legacyTeach();const a=state.plan[state.stage];return `<div class="section-heading"><span>环节 ${state.stage+1} / 7</span><span>${a.min} 分钟</span></div><div class="lesson-stage"><h2>${a.title}</h2><p>${a.desc}</p><div class="notes">${notation()}</div><div class="lesson-tips"></div></div><div class="panel-actions">${state.stage?button('上一环节','prev-stage','secondary'):''}${state.stage<6?button('下一环节','next-stage'):button('返回课堂时间轴','timeline')}</div>`};
metronome=function(){if(state.song!=='茉莉花')return legacyMetronome();stopSound();const ctx=getAudio();for(let i=0;i<16;i++)tone(i%4===0?950:i%4===2?800:650,ctx.currentTime+i*60/80,.08,'sine',.13);toast('4/4拍，80 BPM：强、弱、次强、弱。')};
render();
