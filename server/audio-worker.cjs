const {parentPort,workerData}=require('node:worker_threads');
try{const {analyze,analyzeGroup}=require('./audio-analysis.cjs');const out=workerData.context==='group'?analyzeGroup(workerData.samples,workerData.lesson):analyze(workerData.samples,workerData.context,workerData.lesson);parentPort.postMessage(out)}catch{parentPort.postMessage({error:'音频分析失败，请重新录音'})}
