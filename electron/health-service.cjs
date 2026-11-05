const path=require('node:path');const {Worker}=require('node:worker_threads');
class HealthService {
 constructor(root,onChange=()=>{}){this.root=root;this.onChange=onChange;this.worker=null;this.state={state:'idle'};}
 publish(state){this.state=state;this.onChange(state);return state;}
 start(){
  if(this.worker)return this.state;
  this.publish({state:'running',result:{checked:0,total:0,healthy:0,issues:[]}});
  const worker=new Worker(path.join(__dirname,'health-worker.cjs'),{workerData:{root:this.root}});this.worker=worker;
  worker.on('message',message=>{if(this.worker===worker)this.publish(message);});
  worker.on('error',error=>{if(this.worker===worker)this.publish({state:'failed',error:error.message});});
  worker.on('exit',code=>{if(this.worker===worker){this.worker=null;if(this.state.state==='running')this.publish({state:'failed',error:'The check stopped before finishing. Please try again.'});}});
  return this.state;
 }
 async cancel(){const worker=this.worker;this.worker=null;if(worker){this.publish({...this.state,state:'cancelled'});await worker.terminate();}return this.state;}
}
module.exports={HealthService};
