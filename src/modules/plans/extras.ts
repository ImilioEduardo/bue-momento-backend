export type ExtraEffect =
  | { field: 'extraGuests'; op: 'increment'; value: number }
  | { field: 'extraVideosPerGuest'; op: 'increment'; value: number }
  | { field: 'extraRetentionDays'; op: 'increment'; value: number }
  | { field: 'extendedMaxSeconds'; op: 'set'; value: number };

export const EXTRAS: ReadonlyArray<{
  code: string;
  label: string;
  description: string;
  priceKz: number;
  effect: ExtraEffect;
}> = [
  {
    code: 'GUESTS_50',
    label: '+50 convidados',
    description: 'Adiciona 50 lugares ao teu evento',
    priceKz: 10000,
    effect: { field: 'extraGuests', op: 'increment', value: 50 },
  },
  {
    code: 'VIDEOS_2_FESTA',
    label: '+2 vídeos/convidado (Festa)',
    description: 'Permite 2 vídeos extra por convidado no plano Festa',
    priceKz: 10000,
    effect: { field: 'extraVideosPerGuest', op: 'increment', value: 2 },
  },
  {
    code: 'VIDEOS_2_PREMIUM',
    label: '+2 vídeos/convidado (Premium)',
    description: 'Permite 2 vídeos extra por convidado no plano Premium',
    priceKz: 20000,
    effect: { field: 'extraVideosPerGuest', op: 'increment', value: 2 },
  },
  {
    code: 'RETENTION_6M',
    label: '+6 meses de retenção',
    description: 'Mantém os teus vídeos disponíveis por mais 6 meses',
    priceKz: 15000,
    effect: { field: 'extraRetentionDays', op: 'increment', value: 180 },
  },
  {
    code: 'LONG_VIDEO_60',
    label: 'Vídeos até 60 s',
    description: 'Permite gravar vídeos de até 60 segundos (em vez de 30)',
    priceKz: 15000,
    effect: { field: 'extendedMaxSeconds', op: 'set', value: 60 },
  },
];

export type ExtraCode = (typeof EXTRAS)[number]['code'];
