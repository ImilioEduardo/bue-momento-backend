/** Email ou telefone (com +, espaços, hífenes ou parênteses). */
export const CONTACT_PATTERN = /^(?:[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,63}|\+?[0-9][0-9\s\-()]{6,19})$/;
/** Telefone: 7–20 caracteres, dígitos com +, espaços, hífenes ou parênteses. */
export const PHONE_PATTERN = /^\+?[0-9][0-9\s\-()]{6,19}$/;
