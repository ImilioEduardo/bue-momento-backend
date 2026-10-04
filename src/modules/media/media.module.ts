import { Module } from '@nestjs/common';
import { StreamClient } from './stream.client.js';
import { StorageClient } from './storage.client.js';

@Module({
  providers: [StreamClient, StorageClient],
  exports: [StreamClient, StorageClient],
})
export class MediaModule {}
