import test from 'node:test';
import assert from 'node:assert/strict';
import { qualityCases } from './fixtures/phrase-quality.ts';
import { fixtureGrounded } from './fixtures/grounded.ts';
import { newStrategyPlan, confirmStrategy, gatherCandidates, applyGrounded } from '../src/phrase-strategy.ts';
const sample=qualityCases[1],regions=[{GeoRegionId:'54',GeoRegionName:'Екатеринбург',GeoRegionType:'City'},{GeoRegionId:'1',GeoRegionName:'Калуга',GeoRegionType:'City'}];
function evaluate(change:(row:any,plan:any)=>void=()=>{},phrase='ремонт холодильников bosch') {
  const plan=newStrategyPlan(sample.draft,1);plan.regionId='54';plan.strategy.profile=structuredClone(sample.profile);confirmStrategy(plan,['repair']);
  plan.strategy.requests[0]={...plan.strategy.requests[0],phase:'complete',at:'2026-11-12T07:00:00Z',results:[{phrase,count:'10'}]};
  plan.strategy.candidates=gatherCandidates(plan,sample.draft,regions);
  const response=fixtureGrounded(sample.profile,plan.strategy.candidates),row=response.judgments[0];
  row.decision='review';row.support={basis:'unsupported',factRefs:[]};row.qualifiers=[{text:phrase.split(' ').at(-1)!,kind:'brand',role:'competitor',basis:'unsupported',factRefs:[]}];
  change(row,plan);const before=structuredClone(response);applyGrounded(plan,sample.draft,regions,response);assert.deepEqual(response,before);assert.deepEqual(plan.candidates[0].assessment!.model,row);
  return plan.candidates[0];
}
test('LIVE04-I1: unsupported competitor in raw review preserves entity-specific manual review, raw unchanged',()=>{
  for(const entity of ['bosch','haier','stinol','атлант']){
    const candidate=evaluate(()=>{},'ремонт холодильников '+entity);
    assert.equal(candidate.decision,'review');assert.equal(candidate.selected,false);assert.match(candidate.reason,new RegExp('Уточнение не подтверждено: '+entity));
  }
  assert.equal(evaluate(row=>row.qualifiers[0].basis='uncertain').decision,'review');
});
test('LIVE04-I1: guard is per qualifier and does not bypass adjacent competitor or independent hard blockers',()=>{
  for(const change of [row=>row.decision='include',row=>row.decision='exclude',row=>row.qualifiers[0].basis='fact',row=>row.qualifiers[0].basis='equivalent',row=>row.qualifiers[0].factRefs=['repair:offer'],row=>row.qualifiers.push({...row.qualifiers[0],basis:'fact'}),row=>row.intent='employment'])assert.equal(evaluate(change).decision,'exclude');
  assert.equal(evaluate(()=>{},'ремонт холодильников калуга bosch').decision,'exclude');
  assert.equal(evaluate(()=>{},'ремонт холодильников бесплатно bosch').decision,'exclude');
  assert.equal(evaluate(()=>{},'курсы ремонта холодильников bosch').decision,'exclude');
  assert.equal(evaluate((row,plan)=>plan.strategy.candidates[0].decision='exclude').decision,'exclude');
  for(const change of [row=>row.qualifiers[0].kind='manufacturer',row=>row.qualifiers[0].role='uncertain'])assert.equal(evaluate(change).decision,'review');
});
