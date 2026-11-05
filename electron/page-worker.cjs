const {parentPort,workerData}=require('node:worker_threads');
try{parentPort.postMessage(require('./smart-page.cjs').analyzePage(workerData.html,workerData.url));}catch(error){parentPort.postMessage({error:error.message});}
