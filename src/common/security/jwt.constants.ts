import type { JwtSignOptions, JwtVerifyOptions } from '@nestjs/jwt';

/**
 * Algoritmo, emissor e audiência fixos: um token emitido para um contexto
 * (organizador vs convidado) não é aceite noutro, e não se aceita outro algoritmo.
 */
export const JWT_ISSUER = 'bue-momentos';
export const JWT_AUDIENCE_ORGANIZER = 'organizer';
export const JWT_AUDIENCE_GUEST = 'guest';

export const ORGANIZER_SIGN_OPTIONS: JwtSignOptions = {
  algorithm: 'HS256',
  issuer: JWT_ISSUER,
  audience: JWT_AUDIENCE_ORGANIZER,
};
export const ORGANIZER_VERIFY_OPTIONS: JwtVerifyOptions = {
  algorithms: ['HS256'],
  issuer: JWT_ISSUER,
  audience: JWT_AUDIENCE_ORGANIZER,
};
export const GUEST_SIGN_OPTIONS: JwtSignOptions = {
  algorithm: 'HS256',
  issuer: JWT_ISSUER,
  audience: JWT_AUDIENCE_GUEST,
};
export const GUEST_VERIFY_OPTIONS: JwtVerifyOptions = {
  algorithms: ['HS256'],
  issuer: JWT_ISSUER,
  audience: JWT_AUDIENCE_GUEST,
};
