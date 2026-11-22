import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { groundedPayload,groundedPromptVersion,validateGrounded } from '../src/phrase-policy.ts';
import { fixtureGrounded } from './fixtures/grounded.ts';
import { newStrategyPlan,confirmStrategy,gatherCandidates,applyGrounded } from '../src/phrase-strategy.ts';
import { qualityCases } from './fixtures/phrase-quality.ts';

test('FIX10: exact reviewed prompt04/revision without schema/model/limits changes',()=>{
  const sample=qualityCases[1],payload=groundedPayload(sample.draft,sample.profile,[{id:'c1',phrase:'ремонт холодильников цена'}]);
  assert.equal(groundedPromptVersion,'grounded-prompt-04');
  assert.equal(createHash('sha256').update(payload.body.messages[0].content).digest('hex'),'f283273dfe88f5ab497d4b3f8f15c0c3bc076c3b38ba1cf2d1d5d5547fcf2039');
});
test('FIX10 contract fixtures: unconfirmed channel/territory review; confirmed details and ordinary synonym/price/city include',()=>{
  const cases=[
    {phrase:'заказать материалы через витрину',span:'через витрину',confirmed:false},
    {phrase:'заказать материалы с выездом повсюду',span:'с выездом повсюду',confirmed:false},
    {phrase:'заказать материалы через витрину',span:'через витрину',confirmed:true},
    {phrase:'заказать материалы с выездом повсюду',span:'с выездом повсюду',confirmed:true},
    {phrase:'приобрести материалы'}, {phrase:'материалы цена'}, {phrase:'заказать материалы екатеринбург'},
  ];
  for(const item of cases){
    const evidence='предлагает материалы'+(item.confirmed?' '+item.span:''),draft={description:'Поставщик '+evidence+'.',title:'Материалы',adText:'Условия на сайте.',url:'https://example.com/',region:'Екатеринбург',budget:'7000',period:'7'};
    const profile={offers:[{id:'offer',name:'Материалы',kind:'product' as const,delivery:false,evidence,aliases:[],seeds:['заказать материалы']}],ownBrands:[],exclusions:[],uncertainty:[]};
    const regions=[{GeoRegionId:'54',GeoRegionName:'Екатеринбург',GeoRegionType:'City'}],plan=newStrategyPlan(draft,1);plan.regionId='54';plan.strategy.profile=profile;confirmStrategy(plan,['offer']);
    plan.strategy.requests[0]={...plan.strategy.requests[0],phase:'complete',at:'2026-11-12T07:00:00Z',results:[{phrase:item.phrase,count:'10'}]};plan.strategy.candidates=gatherCandidates(plan,draft,regions);
    // These supplied qualifiers test policy execution, not extraction by a real model.
    const response=fixtureGrounded(profile,plan.strategy.candidates);
    if(item.span)response.judgments[0].qualifiers=[{text:item.span,kind:'other',role:'attribute',basis:item.confirmed?'fact':'unsupported',factRefs:item.confirmed?['offer:offer']:[]}];
    validateGrounded(response,groundedPayload(draft,profile,plan.strategy.candidates));applyGrounded(plan,draft,regions,response);
    const expected=item.span&&!item.confirmed?'review':'include';assert.equal(plan.candidates[0].decision,expected,item.phrase);assert.equal(plan.candidates[0].selected,expected==='include');
  }
});
