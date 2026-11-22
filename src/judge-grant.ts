import { readFileSync, writeFileSync, openSync, closeSync, unlinkSync, renameSync, existsSync } from 'node:fs';
import { DirectError } from './direct-api.ts';
import { hash } from './campaign-plan.ts';
import type { groundedPayload } from './phrase-policy.ts';
export type JudgePreview = { calls: { slot: string; payload: ReturnType<typeof groundedPayload> }[]; [key: string]: unknown };
const denied = (message: string) => Object.assign(new DirectError(message), { notSent: true });
export async function grantedJudge<T>(approvalPath: string, preview: JudgePreview, slot: string, payload: ReturnType<typeof groundedPayload>, send: () => Promise<T>, metadata: () => unknown = () => undefined) {
  let approval: any;
  try { approval = JSON.parse(readFileSync(approvalPath, 'utf8')); } catch { throw denied('Нет отдельного разрешения на новый judge. Провайдер не вызван.'); }
  if (approval.approved !== true || approval.previewHash !== hash(preview) || !Array.isArray(approval.allowedSlots) || !approval.allowedSlots.includes(slot) ||
    hash(preview.calls.find(c => c.slot === slot)?.payload) !== hash(payload) || hash(payload.body) !== payload.payloadHash) throw denied('Разрешение не соответствует точному payload/слоту.');
  const file = approvalPath + '.ledger.json', lock = file + '.lock';
  const update = (change: (ledger: any) => void) => {
    let handle: number;
    try { handle = openSync(lock, 'wx'); } catch { throw denied('Журнал занят или прежний процесс прерван. Требуется сверка, повтора нет.'); }
    try {
      const ledger = existsSync(file) ? JSON.parse(readFileSync(file,'utf8')) : { previewHash: hash(preview), calls: [] };
      if (ledger.previewHash !== hash(preview)) throw denied('Журнал другого разрешения.');
      change(ledger); writeFileSync(file + '.tmp',JSON.stringify(ledger,null,2));renameSync(file + '.tmp',file);
    } finally { closeSync(handle!);unlinkSync(lock); }
  };
  update(ledger => {
    if (ledger.calls.some(c => c.slot === slot) || ledger.calls.length >= 6) throw denied('Слот уже использован; unknown/failed/rejected не повторяются.');
    ledger.calls.push({ slot, payloadHash: payload.payloadHash, at: new Date().toISOString(), status: 'pending' });
  });
  try {
    const result = await send();update(ledger => Object.assign(ledger.calls.find(c=>c.slot===slot),{status:'succeeded',finishedAt:new Date().toISOString(),responseHash:hash(result),response:result,metadata:metadata()}));return result;
  } catch(error) {
    update(ledger => Object.assign(ledger.calls.find(c=>c.slot===slot),{status:error instanceof DirectError?'rejected':'unknown',finishedAt:new Date().toISOString(),metadata:metadata()}));throw error;
  }
}

export function savedGrantResponse(approvalPath: string, preview: JudgePreview, slot: string, payload: ReturnType<typeof groundedPayload>) {
  const file=approvalPath+'.ledger.json';if(!existsSync(file))return undefined;
  const ledger=JSON.parse(readFileSync(file,'utf8')),call=ledger.calls.find(c=>c.slot===slot);
  if(ledger.previewHash!==hash(preview)||hash(preview.calls.find(c=>c.slot===slot)?.payload)!==hash(payload))throw denied('Сохранённое разрешение другого input.');
  if(!call)return undefined;
  if(call.payloadHash!==payload.payloadHash||call.status!=='succeeded'||!call.response||hash(call.response)!==call.responseHash)throw denied('Нет полного подтверждённого ответа; требуется сверка, повтор запрещён.');
  return {response:call.response,metadata:call.metadata,receivedAt:call.finishedAt};
}
