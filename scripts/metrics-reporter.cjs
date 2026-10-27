const {mkdirSync,writeFileSync}=require('node:fs');
class MetricsReporter{
  constructor(){this.tests=[];this.started=Date.now();}
  onTestEnd(test,result){this.tests.push({name:test.titlePath().slice(1).join(' / '),status:result.status,expectedStatus:test.expectedStatus,durationMs:result.duration,retry:result.retry});}
  onEnd(result){const report={at:new Date().toISOString(),status:result.status,durationMs:Date.now()-this.started,scope:'Automated scenarios with synthetic accounts; push transport is simulated where specified',tests:this.tests};mkdirSync('docs/evidence',{recursive:true});writeFileSync('docs/evidence/e2e-metrics.json',JSON.stringify(report,null,2));console.log(JSON.stringify({status:result.status,tests:this.tests.length,passed:this.tests.filter(t=>t.status==='passed').length}));}
}
module.exports=MetricsReporter;
