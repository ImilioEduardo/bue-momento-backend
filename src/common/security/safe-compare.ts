import { createHash, timingSafeEqual } from 'crypto';

/**
 * Comparação de segredos em tempo constante.
 * Faz hash dos dois lados primeiro para que strings de tamanhos diferentes
 * também sejam comparadas em tempo constante (timingSafeEqual exige o mesmo tamanho).
 */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a, 'utf8').digest();
  const hb = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(ha, hb);
}
