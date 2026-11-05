const {parentPort,workerData}=require('node:worker_threads');const {checkLibrary}=require('./health-check.cjs');
checkLibrary(workerData.root,{onProgress:result=>parentPort.postMessage({state:'running',result})}).then(result=>parentPort.postMessage({state:'completed',result}),error=>parentPort.postMessage({state:'failed',error:error.message}));
