import { createDirectApi, parseDirectJson, targeting } from '../../src/direct-api.ts';

// API substitute has no token, external network or live-write path.
export function fakeDirect(options: { account?: string; login?: string; role?: string } = {}) {
  const records = { campaigns: [] as any[], adgroups: [] as any[], keywords: [] as any[], ads: [] as any[] };
  const calls: { resource: string; method: string; params: any }[] = [];
  let seq = 1000;
  let fault: { at: string; mode: 'before' | 'after' | 'api1000' | 'item' | 'stale' | 'timeout'; occurrence: number } | undefined;
  let stale = 0, previousName = '';
  let pagination = false, emptyAds = true, autoGroup = false, wrongAccount = false;
  let advertiserName: string | null = 'Учебный рекламодатель';
  const transport: typeof fetch = async (url, init) => {
    const resource = String(url).split('/').at(-1)!;
    const { method, params } = parseDirectJson(String(init!.body));
    calls.push({ resource, method, params });
    const current = fault?.at === `${resource}/${method}` && --fault.occurrence === 0 ? fault : undefined;
    if (current) fault = undefined;
    if (current?.mode === 'before') throw new Error('secret-must-never-leak');
    if (current?.mode === 'item') return Response.json({ result: { [method==='add'?'AddResults':'UpdateResults']: [{ Errors: [{ Code: 999, Message: 'secret-must-never-leak' }] }] } });
    let result: any;
    if (method === 'hasSearchVolume' && resource === 'keywordsresearch') {
      result = { HasSearchVolumeResults: params.SelectionCriteria.Keywords.map((Keyword: string) => ({ Keyword, RegionIds: params.SelectionCriteria.RegionIds, AllDevices: 'YES' })) };
    } else if (method === 'get') {
      if (resource === 'clients') {
        const client = { ClientId: wrongAccount ? '42' : options.account??'31001001', Login:options.login??'fixture-chief', Representatives:[{Login:!options.role||options.role==='CHIEF'?options.login??'fixture-chief':'other-chief',Role:'CHIEF'}],Type: 'CLIENT', Archived: 'NO', Currency: 'RUB', ForbiddenPlatform: 'NONE', AvailableCampaignTypes: ['UNIFIED_CAMPAIGN'], Grants: [{ Privilege: 'EDIT_CAMPAIGNS', Value: 'YES' }] };
        const marking = params.OrganizationFieldNames?.includes('Name') ? { ErirAttributes: { Organization: { Name: advertiserName } }, TinInfo: { Tin: '1234567890' } } : {};
        result = { Clients: [{ ...client, ...marking }] };
      }
      else if (resource === 'dictionaries') result = params.DictionaryNames[0] === 'GeoRegions' ? { GeoRegions: [{ GeoRegionId: '54', GeoRegionName: 'Екатеринбург' }, { GeoRegionId: '6', GeoRegionName: 'Калуга' }, { GeoRegionId: '213', GeoRegionName: 'Москва' }] } : { Currencies: [{ Currency: 'RUB', Properties: [{ Name: 'MinimumWeeklySpendLimit', Value: '300000000' }] }] };
      else {
        const key = { campaigns: 'Campaigns', adgroups: 'AdGroups', keywords: 'Keywords', ads: 'Ads' }[resource]!;
        let rows = structuredClone(records[resource as keyof typeof records]);
        if (params.SelectionCriteria?.Ids) rows = rows.filter(r => params.SelectionCriteria.Ids.includes(r.Id));
        if (params.SelectionCriteria?.CampaignIds) rows = rows.filter(r => params.SelectionCriteria.CampaignIds.includes(r.CampaignId));
        if (resource === 'campaigns' && stale > 0 && rows.length) { rows[0].Name = previousName; stale--; }
        result = resource === 'ads' && !rows.length && emptyAds ? {} : { [key]: rows };
        if (pagination) result.LimitedBy = '10';
      }
    } else {
      const key = { campaigns: 'Campaigns', adgroups: 'AdGroups', keywords: 'Keywords', ads: 'Ads' }[resource]!;
      const input = params[key][0];
      let id: string;
      if (method === 'update') {
        id = input.Id;
        const row = records[resource as keyof typeof records].find(r => r.Id === id)!;
        previousName = row.Name;
        Object.assign(row, input);
        if (current?.mode === 'stale') stale = 2;
      } else {
        seq=Math.max(seq,...[...records.campaigns,...records.adgroups,...records.keywords].map(row=>Number(row.Id)).filter(Number.isSafeInteger));
        id = resource === 'ads' ? String(9000123400000000123n+BigInt(records.ads.length)) : String(++seq);
        const row = { ...input, Id: id };
        if (resource === 'campaigns') Object.assign(row, { Type: 'UNIFIED_CAMPAIGN', Status: 'DRAFT', State: 'OFF', Statistics: { Clicks: '0', Impressions: '0' } });
        if (resource === 'adgroups') Object.assign(row, { Type: 'UNIFIED_AD_GROUP', Status: 'DRAFT' });
        if (['keywords', 'ads'].includes(resource)) row.CampaignId = records.adgroups.find(g => g.Id === row.AdGroupId)!.CampaignId;
        if (resource === 'keywords') row.State = 'ON';
        if (resource === 'ads') Object.assign(row, { Type: 'RESPONSIVE_AD', Status: 'DRAFT', State: 'OFF', ResponsiveAd: { Href: input.ResponsiveAd.Href, Titles: input.ResponsiveAd.Titles.map((Title: string) => ({ Title })), Texts: input.ResponsiveAd.Texts.map((Text: string) => ({ Text })) } });
        records[resource as keyof typeof records].push(row);
        if (resource === 'adgroups' && autoGroup) records.keywords.push({ Id: String(++seq), CampaignId: row.CampaignId, AdGroupId: id, Keyword: '---autotargeting', State: 'ON', AutotargetingSettings: { ...targeting, Categories: { ...targeting.Categories, Broader: 'YES' } } });
      }
      result = { [method === 'add' ? 'AddResults' : 'UpdateResults']: [{ Id: BigInt(id), Errors: [] }] };
      if (current?.mode === 'after' || current?.mode === 'timeout') throw new Error('secret-must-never-leak');
      if (current?.mode === 'api1000') return Response.json({ error: { error_code: 1000, error_detail: 'secret-must-never-leak' } });
    }
    // IDs in real JSON are numbers, including the 19 digit ad ID.
    const raw = JSON.stringify({ result }, (_key, value) => typeof value === 'bigint' ? JSON.rawJSON(value.toString()) : value);
    return new Response(raw, { status: 200 });
  };
  return {
    api: createDirectApi(async () => 'fixture-token', transport), transport,records, calls,
    fault(at: string, mode: NonNullable<typeof fault>['mode'], occurrence = 1) { fault = { at, mode, occurrence }; },
    pagination(value: boolean) { pagination = value; }, autoGroup(value: boolean) { autoGroup = value; }, wrongAccount(value: boolean) { wrongAccount = value; },
    advertiser(value: string | null) { advertiserName = value; },
    writes() { return calls.filter(c => c.method !== 'get' && c.method !== 'hasSearchVolume'); },
  };
}
