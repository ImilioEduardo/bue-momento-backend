/**
 * Normaliza o contacto para que "+244 912-345-678" e "+244912345678" sejam o mesmo alvo
 * (senão cada formato tinha o seu próprio limite de pedidos de OTP).
 * Email: trim + minúsculas. Telefone: só dígitos, mantendo o "+" inicial se existir.
 */
export function normalizeContact(raw: string): string {
  const value = raw.trim();
  if (value.includes('@')) return value.toLowerCase();
  const digits = value.replace(/\D/g, '');
  return value.startsWith('+') ? `+${digits}` : digits;
}
