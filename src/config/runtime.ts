/** true só em desenvolvimento/testes. NODE_ENV vazio ou desconhecido conta como produção. */
export function isDevEnv(): boolean {
  return ['development', 'test'].includes(process.env['NODE_ENV'] ?? '');
}
