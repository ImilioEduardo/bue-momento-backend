/**
 * Converte um telefone guardado (ex.: "944916156", "244944916156", "+244 944 916 156")
 * para o formato E.164 exigido pelo Twilio ("+244944916156").
 * Números com 9 dígitos começados por 9 são tratados como móveis do país por omissão.
 */
export function toE164(raw: string, defaultCountryCode = '244'): string {
  const value = raw.trim();
  const digits = value.replace(/\D/g, '');
  if (!digits) throw new Error('Telefone vazio');
  if (value.startsWith('+')) return `+${digits}`;
  if (value.startsWith('00')) return `+${digits.slice(2)}`;
  if (digits.startsWith(defaultCountryCode) && digits.length > 9) return `+${digits}`;
  if (digits.length === 9) return `+${defaultCountryCode}${digits}`;
  return `+${digits}`;
}

/** Esconde números de telefone em textos de erro antes de os registar. */
export function maskPhonesInText(text: string): string {
  return text.replace(/\+?\d[\d\s-]{6,}\d/g, '•••');
}
