import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface.js';

/** CORS: só o domínio do frontend, só os métodos/headers que a app usa. */
export function corsOptions(webUrl: string | undefined, dev: boolean): CorsOptions {
  return {
    origin: [webUrl ?? ''].filter(Boolean),
    credentials: true,
    methods: dev ? ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'] : ['GET', 'POST', 'PATCH', 'DELETE'],
    allowedHeaders: dev
      // Em dev os stubs de upload TUS/fotos correm nesta API
      ? ['Content-Type', 'Authorization', 'Tus-Resumable', 'Upload-Offset', 'Upload-Length', 'Upload-Metadata']
      : ['Content-Type', 'Authorization'],
    exposedHeaders: dev ? ['Upload-Offset', 'Location', 'Tus-Resumable'] : [],
    maxAge: 600,
  };
}
