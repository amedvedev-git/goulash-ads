import { DirectError, directId, ReadRateLimitError, retryAfterUntil } from './direct-api.ts';

export type DirectReportRequest = { campaignId: string; dateFrom: string; dateTo: string; reportName: string; includeVat?: 'YES' | 'NO' };
export type DirectReportResult = { status: 'ready' | 'empty' | 'pending'; requestId?: string; retryIn?: number;
  rows?: { campaignId: string; impressions: number; clicks: number; costMicros: string }[] };
export const directReportBody = (r: DirectReportRequest) => JSON.stringify({params:{
  SelectionCriteria:{DateFrom:r.dateFrom,DateTo:r.dateTo,Filter:[{Field:'CampaignId',Operator:'IN',Values:[directId(r.campaignId)]}]},
  FieldNames:['CampaignId','Impressions','Clicks','Cost'],ReportName:r.reportName,ReportType:'CAMPAIGN_PERFORMANCE_REPORT',DateRangeType:'CUSTOM_DATE',Format:'TSV',IncludeVAT:r.includeVat ?? 'NO'}});
export async function parseDirectReport(response: Response, request: DirectReportRequest): Promise<DirectReportResult> {
  const requestId=response.headers.get('RequestId')?.match(/^[\w-]{1,100}$/)?.[0];
  if([201,202].includes(response.status))return {status:'pending',requestId,retryIn:Math.max(1,Math.min(3600,Number(response.headers.get('retryIn'))||60))};
  if(response.status===429)throw new ReadRateLimitError('Reports',retryAfterUntil(response.headers.get('Retry-After')));
  if(!response.ok)throw new DirectError(`Reports: HTTP ${response.status}. Чтение не завершено.`);
  const text=await response.text();if(Buffer.byteLength(text)>1048576)throw new DirectError('Reports: превышен размер отчёта.');
  const lines=text.replace(/^\uFEFF/,'').trim().split(/\r?\n/), columns=lines.shift()?.split('\t');
  const expected=['CampaignId','Impressions','Clicks','Cost'];
  if(!columns||columns.length!==4||new Set(columns).size!==4||expected.some(x=>!columns.includes(x))||lines.length>1)throw new DirectError('Reports: неполный или неподдержанный TSV.');
  const rows=lines.filter(Boolean).map(line=>{
    const cells=line.split('\t');if(cells.length!==4)throw new DirectError('Reports: строка повреждена.');
    const field=(name:string)=>cells[columns.indexOf(name)];
    const count=(name:string)=>{const value=field(name);if(!/^\d+$/.test(value)||!Number.isSafeInteger(Number(value)))throw new DirectError('Reports: некорректный счётчик.');return Number(value);};
    const campaignId=directId(field('CampaignId')),cost=field('Cost');
    if(campaignId!==request.campaignId||!/^\d+$/.test(cost))throw new DirectError('Reports: чужая кампания или некорректная сумма.');
    const impressions=count('Impressions'),clicks=count('Clicks');if(clicks>impressions)throw new DirectError('Reports: некорректные показы/клики.');
    return {campaignId,impressions,clicks,costMicros:BigInt(cost).toString()};
  });
  return {status:rows.length?'ready':'empty',requestId,rows};
}
