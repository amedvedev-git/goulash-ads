export const e1Input = { description: 'Вымышленная мастерская «Полюс» ремонтирует холодильники на дому. Работаем в Екатеринбурге. Не ремонтируем телевизоры.',
  url: 'https://example.com/repair', region: 'Екатеринбург', budget: '7000', period: '7', title: 'Ремонт холодильников',
  adText: 'Узнайте о ремонте и условиях на сайте.', goal: 'Обращения по ремонту холодильников' };
export const e1Profile = { offers: [{ id: 'repair', name: 'Ремонт холодильников', aliases: ['починка холодильников'],
  seeds: ['ремонт холодильников', 'вызов мастера по холодильникам'], kind: 'service' as const, delivery: false,
  evidence: 'ремонтирует холодильники на дому' }], ownBrands: ['Полюс'], exclusions: [{ phrase: 'телевизоры', evidence: 'Не ремонтируем телевизоры' }], uncertainty: ['Стоимость ремонта'] };
