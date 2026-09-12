const lesson=require('../public/lessons/molihua.lesson.json');
const VERSION='class-report-1.0.0';
const round=(x,n=2)=>{if(!Number.isFinite(x))return null;const p=10**n;return Math.round(x*p)/p};
const mean=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:null;
const median=a=>{if(!a.length)return null;const b=[...a].sort((x,y)=>x-y);return b.length%2?b[(b.length-1)/2]:(b[b.length/2-1]+b[b.length/2])/2};
const DECISIONS=['rerecord','slow','steps','metronome','consolidate'];
/**
 * Aggregate real, owner-scoped single-voice measurements into one traceable report.
 * Nothing here invents a score: invalid recordings are counted, never averaged in.
 */
function buildReport(owner,records,{generatedAt=new Date().toISOString()}={}){
 const all=(Array.isArray(records)?records:[]).filter(r=>r&&r.owner===owner&&r.analysis).sort((a,b)=>String(a.createdAt).localeCompare(String(b.createdAt)));
 const valid=all.filter(r=>r.analysis.valid===true),invalid=all.filter(r=>r.analysis.valid!==true);
 const notes=lesson.events.map((event,i)=>{
  const rows=valid.map(r=>(r.analysis.notes||[])[i]).filter(n=>n&&Number.isFinite(n.cents));
  const cents=rows.map(n=>n.cents),average=mean(cents);
  return {index:i+1,id:event.id,measure:event.measure,beat:event.beat%4+1,degree:`${event.degree}${event.octave?'̇':''}`,pitch:event.pitch,
   expectedMidi:event.midi,referenceHz:round(440*2**((event.midi-69)/12),3),durationBeats:event.durationBeats,
   sampleSize:rows.length,meanCents:round(average,1),meanAbsoluteCents:round(mean(cents.map(Math.abs)),1),medianCents:round(median(cents),1),
   meanMeasuredMidi:round(mean(rows.map(n=>n.measuredMidi)),2),meanConfidence:round(mean(rows.map(n=>n.confidence)),3),
   direction:average===null?null:average>35?'偏高':average<-35?'偏低':'阈值内'};
 });
 const decisions=DECISIONS.map(action=>({action,title:({rerecord:'重新录音',slow:'慢速模唱',steps:'阶梯音练习',metronome:'节拍练习',consolidate:'原句巩固'})[action],count:all.filter(r=>r.analysis.decision?.action===action).length})).filter(d=>d.count>0);
 const comparisons=all.filter(r=>r.comparison&&r.comparison.comparable).map(r=>({id:r.id,previousId:r.previousId,createdAt:r.createdAt,pitch:r.comparison.pitch,tempo:r.comparison.tempo,rhythm:r.comparison.rhythm}));
 const attempts=all.map(r=>({id:r.id,createdAt:r.createdAt,source:r.source,context:r.context,previousId:r.previousId||null,valid:r.analysis.valid===true,
  invalidReasons:(r.analysis.invalidReasons||[]).slice(0,3),
  meanAbsoluteCents:r.analysis.valid?round(r.analysis.pitch?.meanAbsoluteCents,1):null,
  estimatedBpm:r.analysis.valid?round(r.analysis.rhythm?.estimatedBpm,1):null,
  meanOnsetErrorSeconds:r.analysis.valid?round(r.analysis.rhythm?.meanOnsetErrorSeconds,3):null,
  confidence:round(r.analysis.confidence,3),decision:r.analysis.decision?.action||null,decisionTitle:r.analysis.decision?.title||null,
  quality:r.analysis.quality||null,sha256:(r.sha256||'').slice(0,16),practiceRequests:(r.practiceRequests||[]).length}));
 const pitchStatuses=comparisons.map(c=>c.pitch?.status);
 const improving=comparisons.length?{comparable:comparisons.length,improved:pitchStatuses.filter(s=>s==='改善').length,regressed:pitchStatuses.filter(s=>s==='退步').length,unchanged:pitchStatuses.filter(s=>s==='无明显变化').length}:null;
 const contexts=[...new Set(all.map(r=>r.context))];
 return {version:VERSION,generatedAt,kind:'real-measurement-sample',owner,
  lesson:{id:lesson.id,version:lesson.version,title:lesson.title,key:lesson.teaching.key,meter:lesson.teaching.meter.join('/'),bpm:lesson.teaching.bpm,
   measures:lesson.teaching.measures,beats:lesson.teaching.beats,events:lesson.events.length,
   source:{title:lesson.source.title,url:lesson.source.url,pdfPage:lesson.source.pdfPage,printedPage:lesson.source.printedPage,location:lesson.source.location,rights:lesson.source.rights},
   audioProvenance:lesson.audio.provenance},
  sample:{attempts:all.length,valid:valid.length,invalid:invalid.length,contexts,
   firstAt:all[0]?.createdAt||null,lastAt:all[all.length-1]?.createdAt||null,
   withRetest:new Set(comparisons.map(c=>c.id)).size},
  metrics:{meanAbsoluteCents:round(mean(valid.map(r=>r.analysis.pitch.meanAbsoluteCents)),1),
   medianSignedCents:round(mean(valid.map(r=>r.analysis.pitch.medianSignedCents)),1),
   estimatedBpm:round(mean(valid.map(r=>r.analysis.rhythm.estimatedBpm)),1),
   meanOnsetErrorSeconds:round(mean(valid.map(r=>r.analysis.rhythm.meanOnsetErrorSeconds)),3),
   confidence:round(mean(valid.map(r=>r.analysis.confidence)),3),
   tempoDirections:valid.reduce((acc,r)=>{const d=r.analysis.rhythm.direction;acc[d]=(acc[d]||0)+1;return acc},{}),
   algorithm:valid[0]?.analysis.version||null},
  notes,decisions,comparisons,improving,attempts,
  declarations:['本报告只汇总本账号内的单人短乐句真实录音测量结果；多人或带伴奏录音被判为无效，不参与平均。',
   '所有数值是声学偏差，不能据此推断气息、心理状态或唱法原因。',
   `有效样本 ${valid.length} 份（共 ${all.length} 次录音）；样本过少时不构成教学效果结论。`,
   '参考乐句为已校对教学对象，谱源与授权限制见来源字段；参考音频由音符数据合成，不是真人范唱。']};
}
module.exports={buildReport,VERSION};
