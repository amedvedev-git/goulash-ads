import type { GeoRegion } from './search-phrases.ts';
const normalize = (value: string) => value.toLocaleLowerCase('ru').replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const words = (value: string) => normalize(value).split(/\s+/).filter(Boolean);
type TypedRegion = GeoRegion & { GeoRegionType?: unknown };
export type GeoMatch = { regionId: string; name: string; type?: string; parentId?: string; span: string; start: number; length: number; basis: string };
export type GeographyAssessment = { status: 'none' | 'allowed' | 'foreign' | 'ambiguous'; matches: GeoMatch[]; reason?: string };
const ambiguousNames = new Set(words('центр север юг запад восток мир победа свобода дружба надежда труд заря рассвет новый новая новое новые северный южный западный восточный центральный'));
function placeForms(word: string) {
  const forms = new Set([word]);
  const add = (length: number, endings: string[]) => endings.forEach(ending => forms.add(word.slice(0, -length) + ending));
  if (/(ый|ий|ой)$/u.test(word)) add(2, ['ого', 'ому', 'ым', 'им', 'ом']);
  else if (/ая$/u.test(word)) add(2, ['ой', 'ую']);
  else if (/ое$/u.test(word)) add(2, ['ого', 'ому', 'ым', 'ом']);
  else if (/а$/u.test(word)) add(1, ['ы', 'и', 'е', 'у', 'ой']);
  else if (/я$/u.test(word)) add(1, ['и', 'е', 'ю', 'ей']);
  else if (/ь$/u.test(word)) add(1, ['и', 'ю', 'я', 'е', 'ем']);
  else if (/[бвгджзклмнпрстфхцчшщ]$/u.test(word)) ['', 'а', 'у', 'ом', 'е'].forEach(ending => forms.add(word + ending));
  return forms;
}
const compiled = new WeakMap<TypedRegion[], {byId: Map<string,TypedRegion>; entries: {region: TypedRegion; name: string[]; forms: Set<string>[]}[]; valid: boolean}>();
export function geographyGuard(phrase: string, targetId: string, regions: TypedRegion[]): GeographyAssessment {
  if (!regions.length || !targetId || !regions.some(region => String(region.GeoRegionId) === targetId))
    return { status: 'ambiguous', matches: [], reason: 'Сохранённый справочник географии не позволяет проверить регион.' };
  let dictionary = compiled.get(regions);
  if (!dictionary) {
    dictionary = { valid:true, byId:new Map(regions.map(region=>[String(region.GeoRegionId),region])), entries:regions.map(region=>{
      const name=words(region.GeoRegionName);return {region,name,forms:name.map(placeForms)};
    }).filter(entry=>entry.name.length>0 && entry.name.every(word=>word.length>=3)) };
    for (const region of regions) {
      let current=String(region.GeoRegionId);const seen=new Set<string>();
      while (current) {
        if(seen.has(current) || !dictionary.byId.has(current)) { dictionary.valid=false;break; }
        seen.add(current);const parent=dictionary.byId.get(current)!.ParentId;
        if(parent==null)break;current=String(parent);
      }
    }
    compiled.set(regions,dictionary);
  }
  if(!dictionary.valid) return {status:'ambiguous',matches:[],reason:'Повреждена иерархия справочника.'};
  const {byId}=dictionary;
  if (byId.size !== regions.length) return { status: 'ambiguous', matches: [], reason: 'Справочник содержит повторяющиеся ID.' };
  const descendant = (id: string, parentId: string) => {
    const seen = new Set<string>();
    while (!seen.has(id)) {
      if (id === parentId) return true;
      seen.add(id);
      const parent = byId.get(id)?.ParentId;
      if (parent === undefined || parent === null) break;
      id = String(parent);
    }
    return false;
  };
  const query = words(phrase);
  const found: (GeoMatch & { allowed: boolean; strong: boolean })[] = [];
  for (const {region,name,forms} of dictionary.entries) {
    for (let start = 0; start <= query.length - name.length; start++) {
      if (!forms.every((form, index) => form.has(query[start + index]))) continue;
      const id = String(region.GeoRegionId), type = typeof region.GeoRegionType === 'string' ? region.GeoRegionType : undefined;
      const allowed = descendant(id, targetId) || descendant(targetId, id);
      const marker = query.slice(Math.max(0, start - 2), start).join(' ');
      const explicit = type === 'City' ? /(?:^| )(город|городе|города|городом)$/u.test(marker)
        : type === 'Village' ? /(?:^| )(село|селе|села|деревня|деревне|деревни|поселок|поселке)$/u.test(marker)
        : type === 'Federal district' ? /федеральный округ$/u.test(marker) : /(?:^| )(город|городе|село|селе|деревня|деревне|область|области|район|районе)$/u.test(marker);
      const parentName = words(byId.get(String(region.ParentId))?.GeoRegionName ?? '');
      const parentPresent = parentName.length > 0 && query.some((_, index) => parentName.every((word, offset) => query[index + offset] === word));
      const common = name.some(word => ambiguousNames.has(word)) || (name.length === 1 && /(?:ый|ий|ая|ое)$/u.test(name[0]));
      const strong = explicit || parentPresent || (type === 'City' && !common);
      found.push({ regionId: id, name: region.GeoRegionName, type, parentId: region.ParentId == null ? undefined : String(region.ParentId),
        span: query.slice(start, start + name.length).join(' '), start, length: name.length, allowed, strong,
        basis: allowed ? 'Иерархия целевого региона.' : explicit ? 'Явно указан тип места.' : parentPresent ? 'Указан родительский регион.' : strong ? 'Полное название города.' : 'Название без достаточного географического контекста.' });
    }
  }
  // A full name wins over any shorter overlapping match, regardless of dictionary order.
  const matches = found.filter(match => !found.some(other => other.length > match.length && other.start <= match.start && other.start + other.length >= match.start + match.length));
  const foreign = matches.filter(match => match.strong && !match.allowed && !matches.some(other => other.allowed && other.start === match.start && other.length === match.length));
  if (foreign.length) return { status: 'foreign', matches: foreign, reason: `Другая география: ${foreign[0].name}.` };
  if (matches.some(match => !match.allowed)) return { status: 'ambiguous', matches, reason: 'Название места неоднозначно; проверьте географию вручную.' };
  return { status: matches.length ? 'allowed' : 'none', matches };
}
