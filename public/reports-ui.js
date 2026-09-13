/* Real-measurement report center. Aggregates stored, owner-scoped measurements only. */
const legacyReportsPage=reports,legacyReportPage=report,reportsBaseRender=render;
let overview=null,overviewState='idle',overviewError='',overviewOwner=null,measured={id:null,record:null,status:'idle',error:''};
const wavHref=id=>'/api/audio/attempts/'+encodeURIComponent(id)+'/wav';
const num=(v,suffix='')=>v===null||v===undefined||(typeof v==='number'&&!Number.isFinite(v))?'—':`${v}${suffix}`;
const stamp=t=>{try{return new Date(t).toLocaleString('zh-CN',{dateStyle:'medium',timeStyle:'short'})}catch{return String(t||'')}};
const lessonTitle=()=>overview?.lesson?.title||(typeof lesson!=='undefined'?lesson.title:'茉莉花');

function ensureOverview(){
 if(!authReady)return;
 if(!currentUser){overviewState='guest';return}
 if(overviewState==='loading'||overviewState==='ready')return;
 overviewOwner=currentUser.id;overviewState='loading';
 api('reports/overview')
  .then(r=>{if(currentUser?.id!==overviewOwner)return;overview=r;overviewError='';overviewState='ready'})
  .catch(e=>{if(currentUser?.id!==overviewOwner)return;overviewError=e.message||'读取失败';overviewState='error'})
  .then(()=>{if(state.route==='reports'||state.route==='report')render()});
}
function openMeasured(id){
 measured={id,record:null,status:'loading',error:''};
 go('report');
 api('audio/attempts/'+encodeURIComponent(id))
  .then(r=>{if(measured.id!==id)return;measured.record=r;measured.status='ready'})
  .catch(e=>{if(measured.id!==id)return;measured.status='error';measured.error=e.message||'读取失败'})
  .then(()=>{if(state.route==='report'&&measured.id===id)render()});
}
function noteLabel(n){
 if(n.degree!==undefined&&n.pitch!==undefined)return `${n.index}. <b>${esc(n.degree)}</b> ${esc(n.pitch)}`;
 const event=typeof lesson!=='undefined'&&Array.isArray(lesson.events)?lesson.events[n.index-1]:null;
 const name=event?`<b>${esc(event.degree)}</b> ${esc(event.pitch)}`:`MIDI ${esc(n.expectedMidi)}`;
 return `${n.index}. ${name}`;
}
function noteRow(n){
 const size=n.sampleSize??(n.cents===undefined?0:1);
 const cents=n.meanCents??n.cents;
 const width=size?Math.min(50,Math.abs(cents)*.25):0;
 const cls=!size?'miss':cents>35?'sharp':cents<-35?'flat':'';
 return `<div class="note-row ${size?'':'empty'}"><span class="note-label">${noteLabel(n)}</span><div class="note-track"><i class="note-bar ${cls}" style="width:${width.toFixed(1)}%"></i></div><span class="note-value">${size?`${cents>0?'+':''}${cents} 音分`:'无数据'}</span></div>`;
}
function realSection(){
 if(!currentUser)return `<section class="panel empty"><div class="big-icon">📈</div><h2>真实测量报告需要登录</h2><p>登录后，本账号每一次《茉莉花》单人短乐句录音、指标与复测对比都会汇总在这里，并可用于打印或导出 PDF。</p><div class="panel-actions" style="justify-content:center"><button class="btn" data-useraction="login">登录账号</button></div></section>`;
 if(overviewState==='error')return `<section class="panel empty"><h2>暂时读不到测量记录</h2><p>${esc(overviewError)}</p><div class="panel-actions" style="justify-content:center"><button class="btn secondary" data-rr="reload">重新读取</button></div></section>`;
 if(!overview)return `<section class="panel"><h2>正在汇总你的真实测量…</h2><div class="progress-track"><div style="width:55%"></div></div><p>只统计已保存录音，不会补造任何分数。</p></section>`;
 const o=overview;
 const head=`<div class="section-heading"><h2>${icon('chart')}真实测量记录</h2><span class="badge real">${o.sample.valid} / ${o.sample.attempts} 次有效</span></div>
  <div class="source-strip"><span>《${esc(o.lesson.title)}》</span><span>${esc(o.lesson.key)} · ${o.lesson.meter} · ${o.lesson.bpm} BPM</span><span>${o.lesson.measures}小节 · ${o.lesson.events}音</span><span>单人清唱 1–20 秒</span><span>算法 ${esc(o.metrics.algorithm||'—')}</span></div>`;
 if(!o.sample.attempts)return `<section class="panel">${head}<div class="empty" style="padding:26px 10px"><h3>还没有真实录音</h3><p>到「AI听唱」用《茉莉花》录一段安静环境的单人清唱，测量结果会自动汇总到这里。</p><div class="panel-actions" style="justify-content:center"><button class="btn" data-route="listen">${icon('mic')}去录一段</button></div></div>${declarationList(o)}</section>`;
 const stats=`<div class="report-grid cols-4">
  <div class="stat"><label>有效录音</label><strong>${o.sample.valid}<small> / ${o.sample.attempts}</small></strong><small>无效 ${o.sample.invalid} 次，不参与平均</small></div>
  <div class="stat"><label>平均绝对音高偏差</label><strong>${num(o.metrics.meanAbsoluteCents)}<small> 音分</small></strong><small>中位有符号偏差 ${num(o.metrics.medianSignedCents)} 音分</small></div>
  <div class="stat"><label>平均速度</label><strong>${num(o.metrics.estimatedBpm)}<small> BPM</small></strong><small>${esc(Object.entries(o.metrics.tempoDirections||{}).map(([k,v])=>`${k} ${v}次`).join(' · ')||'—')}</small></div>
  <div class="stat"><label>平均起音误差</label><strong>${num(o.metrics.meanOnsetErrorSeconds)}<small> 秒</small></strong><small>已扣除整体速度差异</small></div>
 </div>`;
 const perNote=`<h3 style="margin-top:24px">逐音平均偏差（全部有效录音）</h3><p class="fine-print">越靠近中线越好。左侧偏低，右侧偏高，超过 ±35 音分才算超出当前阈值。</p><div class="note-chart">${o.notes.map(n=>noteRow(n)).join('')}</div>
 <details><summary>查看逐音样本量与参考音高</summary><div class="reference-table-wrap"><table class="reference-table"><thead><tr><th>音符</th><th>小节 / 拍位</th><th>唱名</th><th>参考音高</th><th>参考频率</th><th>样本量</th><th>平均偏差</th><th>方向</th></tr></thead><tbody>${o.notes.map(n=>`<tr><td>${n.index}</td><td>${n.measure} / ${n.beat}</td><td>${esc(n.degree)}</td><td>${esc(n.pitch)}</td><td>${n.referenceHz} Hz</td><td>${n.sampleSize}</td><td>${num(n.meanCents)} 音分</td><td>${esc(n.direction||'—')}</td></tr>`).join('')}</tbody></table></div></details>`;
 const improving=o.improving?`<h3 style="margin-top:24px">复测前后比较</h3><div class="comparison-grid"><div><label>可比对复测</label><b>${o.improving.comparable} 组</b><small>两组录音均为有效测量</small></div><div><label>音高误差改善</label><b>${o.improving.improved} 组</b><small>没有进步也会照实记录</small></div><div><label>退步 / 无明显变化</label><b>${o.improving.regressed} / ${o.improving.unchanged}</b><small>按 5 音分容差判定</small></div></div>`:'';
 const rows=o.attempts.slice().reverse().map(a=>`<article class="panel report-row attempt-row"><div><h3>${stamp(a.createdAt)} <span class="badge ${a.valid?'real':'warn'}">${a.valid?'有效测量':'无效录音'}</span></h3><p>${a.valid?`平均绝对偏差 ${a.meanAbsoluteCents} 音分 · ${a.estimatedBpm} BPM · 起音误差 ${a.meanOnsetErrorSeconds} 秒 · 建议：${esc(a.decisionTitle||'—')}`:`不参与平均：${esc((a.invalidReasons||[]).join('；'))}`}</p><div class="attempt-meta"><code>${esc(a.source)}</code><code>${esc(a.context)}</code><code>SHA ${esc(a.sha256)}…</code>${a.practiceRequests?`<span class="muted">练习请求 ${a.practiceRequests} 次</span>`:''}${a.previousId?'<span class="muted">含复测</span>':''}</div></div><button class="btn secondary small" data-report-open="${a.id}">查看报告 ${icon('arrow')}</button></article>`).join('');
 return `<section class="panel">${head}${coachBlock()}${stats}${perNote}${improving}<h3 style="margin-top:24px">记录明细（新→旧）</h3><div class="report-list">${rows}</div>${declarationList(o)}</section>`;
}
let classTask={status:'idle',error:'',result:null};
function classReportBody(){
 if(classTask.status==='loading')return `<p>正在按真实测量汇总…</p><div class="progress-track"><div style="width:60%"></div></div>`;
 if(classTask.status==='error')return `<div class="report-note"><b>汇总未完成</b><br>${esc(classTask.error)}</div><button class="btn secondary" data-rr="class">重新汇总</button>`;
 if(classTask.status==='ready'){
  const s=classTask.result.summary;
  if(!s.sampleSize)return `<div class="report-note">${esc(s.note)}</div><button class="btn secondary" data-rr="class">重新汇总</button>`;
  return `<div class="summary-box"><b>样本量 ${s.sampleSize} 次有效录音</b>${s.excluded?`（另有 ${s.excluded} 次无效录音，不计入平均）`:''}<br>平均绝对音高偏差：${num(s.meanAbsoluteCents)} 音分<br>平均速度比：${num(s.tempoRatio)}（1 为参考速度）</div><p class="fine-print">${esc(s.note)}</p><button class="btn secondary" data-rr="class">重新汇总</button>`;
 }
 return `<p class="fine-print">服务端按本账号已保存的有效录音汇总；没有录音时不会补造任何数字，未配置模型时同样可用。</p><button class="btn" data-rr="class">生成班级汇总</button>`;
}
function coachBlock(){return `<div class="coaching-box no-print"><h3>班级汇总（Agent）</h3><div data-coach-out>${classReportBody()}</div></div>`;}
function startClassReport(){
 if(classTask.status==='loading')return;
 classTask={status:'loading',error:'',result:null};render();
 const poll=(id,n)=>api('agent/tasks/'+id).then(t=>{
  if(t.status==='running'&&n>0)return setTimeout(()=>poll(id,n-1),300);
  classTask=t.status==='completed'&&t.result?{status:'ready',error:'',result:t.result}:{status:'error',error:agentErrorText(t.error||'AGENT_FAILED'),result:null};
  if(state.route==='reports')render();
 });
 api('agent/class-report-tasks','POST',{}).then(k=>poll(k.id,20)).catch(e=>{classTask={status:'error',error:e.message||'汇总未完成',result:null};if(state.route==='reports')render()});
}
function declarationList(o){
 return `<div class="fine-print" style="margin-top:18px">${o.declarations.map(d=>`· ${esc(d)}`).join('<br>')}<br>· 谱源：<a href="${esc(o.lesson.source.url)}#page=${o.lesson.source.pdfPage}" target="_blank" rel="noopener">${esc(o.lesson.source.title)}</a>（PDF 第 ${o.lesson.source.pdfPage} 页 / 印刷页 ${esc(o.lesson.source.printedPage)}）<br>· 参考音频：${esc(o.lesson.audioProvenance)}</div>`;
}
function demoSection(){
 const records=(state.records||[]).map((r,i)=>`<article class="panel report-row"><div><h3>🌼 《${esc(r.song)}》课堂报告</h3><p>${esc(r.grade)} · ${r.students}人 · ${esc(r.date)} <span class="badge">演示记录</span></p></div><button class="btn secondary small" data-report="${i}">查看报告 ${icon('arrow')}</button></article>`).join('');
 return `<section><div class="section-heading"><h2>${icon('book')}演示记录</h2><span class="badge">示例数据，仅用于展示界面</span></div><div class="report-list">${records}<article class="panel report-row"><div><h3>🌼 《茉莉花》课堂报告</h3><p>四年级 · 28人 · 9月10日 <span class="badge">示例报告</span></p></div><button class="btn secondary small" data-action="sample-report" data-song="茉莉花">查看报告 ${icon('arrow')}</button></article><article class="panel report-row"><div><h3>🌧️ 《小雨沙沙》课堂报告</h3><p>三年级 · 23人 · 9月8日 <span class="badge">示例报告</span></p></div><button class="btn secondary small" data-action="sample-report" data-song="小雨沙沙">查看报告 ${icon('arrow')}</button></article></div><p class="fine-print">演示记录使用预设数值，不对应任何真实学生；真实测量请看上方「真实测量记录」。</p></section>`;
}
reports=function(){
 ensureOverview();
 return `<main class="page">${heading('CLASSROOM JOURNAL','把每一点真实的变化，留在这里','课堂报告分成两部分：本账号的真实单人短乐句测量，以及标注清楚的界面演示记录。')}<div class="report-sections">${realSection()}</div><div style="height:30px"></div>${demoSection()}</main>`;
};
function reportActions(){
 return `<div class="report-actions no-print"><button class="btn" data-rr="print">${icon('download')}打印 / 另存为 PDF</button><button class="btn secondary" data-rr="text">下载文字报告</button><button class="btn secondary" data-rr="json">导出测量JSON</button><a class="btn secondary" href="${wavHref(measured.id)}" download="测量-${esc(measured.id)}.wav">下载这次WAV</a><button class="btn light" data-route="reports">${icon('arrow')}返回课堂报告</button></div>`;
}
function measuredReportPage(){
 const back=`<button class="btn secondary no-print" data-route="reports">返回课堂报告</button>`;
 if(measured.status==='loading')return `<main class="page">${heading('REAL MEASUREMENT','正在读取测量记录','只展示已保存的真实测量，不生成任何推测分数。',back)}<div class="panel"><div class="progress-track"><div style="width:60%"></div></div><p>加载中…</p></div></main>`;
 if(measured.status==='error')return `<main class="page">${heading('REAL MEASUREMENT','记录读取失败',esc(measured.error),back)}<div class="panel empty"><div class="big-icon">🌫️</div><h2>无法读取这次录音</h2><p>可能是记录已被删除，或当前账号无权访问。</p></div></main>`;
 const r=measured.record,a=r.analysis,valid=a.valid===true;
 const head=`${heading('REAL MEASUREMENT',`《${esc(lessonTitle())}》真实测量报告`,`${stamp(r.createdAt)} · ${esc(r.source==='microphone'?'麦克风录音':'上传音频')} · ${esc(r.context==='single'?'单人清唱':'多人/带伴奏')} · 算法 ${esc(a.version)}`,back)}`;
 const printHead=`<div class="print-head">声入山野 · 真实测量报告 · 生成于 ${stamp(new Date().toISOString())} · 录音ID ${esc(r.id)}</div>`;
 const source=`<div class="source-strip"><span>教学：${esc(a.reference.key)} · ${esc(a.reference.meter)} · ${a.reference.bpm} BPM</span><span>教学对象 ${esc(a.lessonId)} / ${esc(a.lessonVersion)}</span><span>有效录音：${valid?'是':'否'}</span><span>可信度 ${num(Math.round((a.confidence||0)*100))}%（周期性启发值）</span></div>`;
 const quality=`<p class="fine-print">音量 ${num(a.quality.rmsDb)} dBFS · 削波 ${num(Math.round((a.quality.clippingRatio||0)*100))}% · 时长 ${num(a.quality.seconds)} 秒${a.quality.voicedRatio!==undefined?` · 周期性帧比例 ${num(Math.round(a.quality.voicedRatio*100))}%`:''}</p>`;
 let body;
 if(!valid){
  body=`<div class="report-note"><b>本次录音无法作为有效测量</b><br>${a.invalidReasons.map(esc).join('；')}</div>${a.notes.length?`<h3 style="margin-top:20px">候选对齐数据（不可作为评分）</h3><div class="reference-table-wrap"><table class="reference-table"><thead><tr><th>音</th><th>小节 / 拍位</th><th>偏差</th><th>方向</th><th>可信度</th></tr></thead><tbody>${a.notes.map(n=>`<tr><td>${n.index}</td><td>${n.measure} / ${n.beat}</td><td>${n.cents} 音分</td><td>${esc(n.direction)}</td><td>${Math.round(n.confidence*100)}%</td></tr>`).join('')}</tbody></table></div>`:''}`;
 }else{
  body=`<div class="report-grid cols-4">
   <div class="stat"><label>平均绝对音高偏差</label><strong>${num(a.pitch.meanAbsoluteCents)}<small> 音分</small></strong><small>中位有符号 ${num(a.pitch.medianSignedCents)} 音分</small></div>
   <div class="stat"><label>速度</label><strong>${num(a.rhythm.estimatedBpm)}<small> BPM</small></strong><small>${esc(a.rhythm.direction)}（参考 ${a.reference.bpm}）</small></div>
   <div class="stat"><label>平均起音误差</label><strong>${num(a.rhythm.meanOnsetErrorSeconds)}<small> 秒</small></strong><small>已扣除整体速度差异</small></div>
   <div class="stat"><label>可信度</label><strong>${num(Math.round(a.confidence*100))}<small>%</small></strong><small>取周期性与逐音可信度下界</small></div>
  </div>
  <h3 style="margin-top:24px">逐音偏差</h3><div class="note-chart">${a.notes.map(n=>noteRow(n)).join('')}</div>
  <p class="fine-print">${esc(a.rhythm.method)}。阈值内为 ±35 音分。</p>
  <details><summary>查看逐音明细</summary><div class="reference-table-wrap"><table class="reference-table"><thead><tr><th>音</th><th>小节 / 拍位</th><th>起点/秒</th><th>参考音高</th><th>实测音高</th><th>偏差</th><th>方向</th><th>可信度</th><th>起音偏差/秒</th></tr></thead><tbody>${a.notes.map(n=>`<tr><td>${n.index}</td><td>${n.measure} / ${n.beat}</td><td>${n.startSeconds}</td><td>${n.expectedMidi}</td><td>${n.measuredMidi}</td><td>${n.cents} 音分</td><td>${esc(n.direction)}</td><td>${Math.round(n.confidence*100)}%</td><td>${n.onsetErrorSeconds}</td></tr>`).join('')}</tbody></table></div></details>
  <div class="decision"><b>下一步：${esc(a.decision.title)}</b><br>${esc(a.decision.reason)}</div>`;
 }
 const comparison=r.comparison?`<h3 style="margin-top:20px">复测比较</h3>${r.comparison.comparable?`<div class="comparison-grid">${[['pitch','音高误差（音分）'],['tempo','速度偏差（比例）'],['rhythm','节奏误差（秒）']].map(([k,label])=>`<div><label>${label}</label><b>${r.comparison[k].before} → ${r.comparison[k].after}</b><small>${esc(r.comparison[k].status)}（越小越好）</small></div>`).join('')}</div>`:`<p>${esc(r.comparison.reason)}</p>`}`:'';
 const trace=`<details style="margin-top:18px"><summary>追溯信息</summary><div class="fine-print">录音ID：${esc(r.id)}<br>前次ID：${esc(r.previousId||'无')}<br>SHA-256：${esc(r.sha256)}<br>格式：${esc(r.format)}<br>算法：${esc(a.version)} · 教学对象 ${esc(a.lessonId)} / ${esc(a.lessonVersion)}<br>练习请求：${r.practiceRequests.length} 次（请求不代表已完成练习）<br>创建时间：${stamp(r.createdAt)}</div></details>`;
 return `<main class="page">${printHead}${head}${source}${quality}${body}${comparison}<h3 style="margin-top:20px">当前录音</h3><audio class="result-audio no-print" controls src="${wavHref(r.id)}"></audio>${trace}<div class="fine-print" style="margin-top:14px">· 只描述声学偏差，不能据此推断气息、心理状态或唱法原因。<br>· 多人或有伴奏的声音不能作为个人准确评分。<br>· 参考音频由音符数据合成，不是真人范唱；合成样本验收不等于真人教学效果验证。</div>${reportActions()}</main>`;
}
report=function(){
 if(measured.id)return measuredReportPage();
 return legacyReportPage();
};
function downloadMeasuredText(){
 const r=measured.record;if(!r)return;const a=r.analysis;
 const lines=[`声入山野｜《${lessonTitle()}》真实测量报告`,'',`录音时间：${stamp(r.createdAt)}`,`录音来源：${r.source} · 场景：${r.context}`,`录音ID：${r.id}`,`SHA-256：${r.sha256}`,`算法：${a.version} · 教学对象：${a.lessonId} / ${a.lessonVersion}`,'',a.valid?`结果：有效测量（可信度 ${Math.round(a.confidence*100)}%，周期性启发值）`:`结果：无效录音 → ${a.invalidReasons.join('；')}`,''];
 if(a.valid){lines.push(`平均绝对音高偏差：${a.pitch.meanAbsoluteCents} 音分`,`中位有符号偏差：${a.pitch.medianSignedCents} 音分`,`速度：${a.rhythm.estimatedBpm} BPM（${a.rhythm.direction}）`,`平均起音误差：${a.rhythm.meanOnsetErrorSeconds} 秒`,'','逐音偏差：',...a.notes.map(n=>`  ${String(n.index).padStart(2,' ')}. ${n.pitch} 小节${n.measure}/拍${n.beat}：${n.cents>0?'+':''}${n.cents} 音分（${n.direction}，可信度 ${Math.round(n.confidence*100)}%）`),'')}
 if(r.comparison?.comparable)lines.push('复测比较：',`  音高误差：${r.comparison.pitch.before} → ${r.comparison.pitch.after}（${r.comparison.pitch.status}）`,`  速度偏差：${r.comparison.tempo.before} → ${r.comparison.tempo.after}（${r.comparison.tempo.status}）`,`  节奏误差：${r.comparison.rhythm.before} → ${r.comparison.rhythm.after}（${r.comparison.rhythm.status}）`,'');
 lines.push('声明：','  · 只汇总单人短乐句的真实声学测量，不代表教学效果或学生能力。','  · 声学偏差不能推断气息、心理状态或唱法原因。','  · 参考音频由音符数据合成，不是真人范唱。','');
 const url=URL.createObjectURL(new Blob(['\ufeff'+lines.join('\n')],{type:'text/plain;charset=utf-8'}));const link=document.createElement('a');link.href=url;link.download=`声入山野-${lessonTitle()}-真实测量报告.txt`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('文字报告已下载');
}
function printMeasured(){
 const previousPrint=document.body.dataset.print,previousTitle=document.title;
 const details=[...document.querySelectorAll('details')].map(el=>({el,open:el.open}));
 details.forEach(d=>{d.el.open=true});
 document.body.dataset.print='measured';document.title=`声入山野-${lessonTitle()}-真实测量报告`;
 const restore=()=>{if(previousPrint)document.body.dataset.print=previousPrint;else delete document.body.dataset.print;document.title=previousTitle;details.forEach(d=>{d.el.open=d.open});window.removeEventListener('afterprint',restore)};
 window.addEventListener('afterprint',restore);
 try{window.print()}catch{restore()}
}
document.addEventListener('click',e=>{
 const open=e.target.closest('[data-report-open]')?.dataset.reportOpen;
 if(open)return openMeasured(open);
 if(measured.id&&e.target.closest('[data-report],[data-action="sample-report"]')){measured={id:null,record:null,status:'idle',error:''};render();return}
 const rr=e.target.closest('[data-rr]')?.dataset.rr;
 if(rr==='class')startClassReport();
 if(rr==='reload'){overview=null;overviewError='';overviewState='idle';ensureOverview();render()}
 if(rr==='print')printMeasured();
 if(rr==='text')downloadMeasuredText();
 if(rr==='json'&&measured.record){const url=URL.createObjectURL(new Blob([JSON.stringify(measured.record,null,2)],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download='测量-'+measured.id+'.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
});
render=function(){
 if(overviewOwner&&overviewOwner!==currentUser?.id){overview=null;overviewState='idle';overviewError='';overviewOwner=null;measured={id:null,record:null,status:'idle',error:''};classTask={status:'idle',error:'',result:null}}
 reportsBaseRender();
};
render();
