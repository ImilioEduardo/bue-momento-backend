import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  HeadObjectCommand,
  DeleteObjectCommand,
  PutObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Readable } from 'stream';

export interface IStorageClient {
  presignPutUrl(key: string, contentType: string, sizeBytes: number, expiresInSec: number): Promise<string>;
  presignGetUrl(key: string, expiresInSec: number): Promise<string>;
  headObject(key: string): Promise<{ exists: boolean; sizeBytes?: number; contentType?: string }>;
  readPrefix(key: string, bytes: number): Promise<Buffer>;
  deleteObject(key: string): Promise<void>;
  streamUpload(key: string, body: Readable, contentType: string): Promise<void>;
}

@Injectable()
export class StorageClient implements IStorageClient {
  private readonly logger = new Logger(StorageClient.name);
  private readonly s3: S3Client | null = null;
  private readonly bucket: string;

  constructor(config: ConfigService) {
    const accountId = config.get<string>('R2_ACCOUNT_ID') ?? '';
    const accessKeyId = config.get<string>('R2_ACCESS_KEY_ID') ?? '';
    const secretAccessKey = config.get<string>('R2_SECRET_ACCESS_KEY') ?? '';
    this.bucket = config.get<string>('R2_BUCKET') ?? '';
    const endpoint =
      config.get<string>('R2_ENDPOINT') ??
      `https://${accountId}.r2.cloudflarestorage.com`;

    if (accountId && accessKeyId && secretAccessKey && this.bucket) {
      this.s3 = new S3Client({
        region: 'auto',
        endpoint,
        credentials: { accessKeyId, secretAccessKey },
      });
    }
  }

  get isConfigured(): boolean {
    return this.s3 !== null;
  }

  async presignPutUrl(
    key: string,
    contentType: string,
    sizeBytes: number,
    expiresInSec: number,
  ): Promise<string> {
    if (!this.s3) return `dev://put/${key}`;
    return getSignedUrl(
      this.s3,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: contentType,
        ContentLength: sizeBytes,
      }),
      { expiresIn: expiresInSec },
    );
  }

  async presignGetUrl(key: string, expiresInSec: number): Promise<string> {
    if (!this.s3) return `dev://get/${key}`;
    return getSignedUrl(
      this.s3,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn: expiresInSec },
    );
  }

  async headObject(key: string): Promise<{ exists: boolean; sizeBytes?: number; contentType?: string }> {
    if (!this.s3) return { exists: true };
    try {
      const res = await this.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return { exists: true, sizeBytes: res.ContentLength, contentType: res.ContentType };
    } catch (err: unknown) {
      const name = (err as { name?: string })?.name ?? '';
      if (name === 'NotFound' || name === '404') return { exists: false };
      throw err;
    }
  }

  /** Lê só os primeiros `bytes` do objecto (para verificar a assinatura do ficheiro). */
  async readPrefix(key: string, bytes: number): Promise<Buffer> {
    if (!this.s3) return Buffer.alloc(0);
    const res = await this.s3.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key, Range: `bytes=0-${bytes - 1}` }),
    );
    const arr = await res.Body?.transformToByteArray();
    return Buffer.from(arr ?? []);
  }

  async deleteObject(key: string): Promise<void> {
    if (!this.s3) return;
    try {
      await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    } catch (err: unknown) {
      this.logger.warn(`deleteObject ${key} failed: ${(err as Error).message}`);
    }
  }

  // Streaming multipart upload — keeps RAM usage bounded regardless of file size.
  async streamUpload(key: string, body: Readable, contentType: string): Promise<void> {
    if (!this.s3) {
      // Dev: drain the stream so the caller doesn't hang
      await new Promise<void>((resolve, reject) =>
        body.resume().once('end', resolve).once('error', reject),
      );
      return;
    }
    const upload = new Upload({
      client: this.s3,
      params: { Bucket: this.bucket, Key: key, Body: body, ContentType: contentType },
      queueSize: 4,
      partSize: 10 * 1024 * 1024,
    });
    await upload.done();
  }
}
