const {parentPort,workerData}=require('node:worker_threads');
try{parentPort.postMessage(require('./audio-analysis.cjs').analyze(workerData.samples,workerData.context))}catch{parentPort.postMessage({error:'音频分析失败，请重新录音'})}
