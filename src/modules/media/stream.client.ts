import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface IStreamClient {
  createTusUpload(params: {
    submissionId: string;
    uploadLength: number;
    maxDurationSec: number;
    expiryISO: string;
  }): Promise<{ tusUploadUrl: string; streamUid: string }>;
  requestMp4Download(uid: string): Promise<void>;
  getMp4DownloadUrl(uid: string): Promise<string>;
  getPlaybackUrl(uid: string): string;
  deleteVideo(uid: string): Promise<void>;
}

@Injectable()
export class StreamClient implements IStreamClient {
  private readonly logger = new Logger(StreamClient.name);

  constructor(private readonly config: ConfigService) {}

  get isConfigured(): boolean {
    return !!(
      this.config.get<string>('CF_ACCOUNT_ID') &&
      this.config.get<string>('CF_STREAM_API_TOKEN')
    );
  }

  private get accountId() {
    return this.config.get<string>('CF_ACCOUNT_ID')!;
  }
  private get apiToken() {
    return this.config.get<string>('CF_STREAM_API_TOKEN')!;
  }

  async createTusUpload(params: {
    submissionId: string;
    uploadLength: number;
    maxDurationSec: number;
    expiryISO: string;
  }): Promise<{ tusUploadUrl: string; streamUid: string }> {
    const b64 = (s: string) => Buffer.from(s).toString('base64');
    // TUS Upload-Metadata: comma-separated key base64(value) pairs
    // https://developers.cloudflare.com/stream/uploading-videos/direct-creator-uploads/
    const metadata = [
      `maxdurationseconds ${b64(String(params.maxDurationSec))}`,
      `expiry ${b64(params.expiryISO)}`,
      `name ${b64(params.submissionId)}`,
      `requiresignedurls`,
    ].join(',');

    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/stream?direct_user=true`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
          'Tus-Resumable': '1.0.0',
          'Upload-Length': String(params.uploadLength),
          'Upload-Metadata': metadata,
        },
      },
    );

    if (!res.ok) {
      throw new Error(`Stream API error ${res.status}: ${await res.text()}`);
    }

    const tusUploadUrl = res.headers.get('location') ?? '';
    const streamUid = res.headers.get('stream-media-id') ?? '';

    if (!tusUploadUrl || !streamUid) {
      throw new Error('Stream API did not return location or stream-media-id headers');
    }

    return { tusUploadUrl, streamUid };
  }

  async requestMp4Download(uid: string): Promise<void> {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/stream/${uid}/downloads`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiToken}` },
      },
    );
    if (!res.ok) {
      // Non-fatal: MP4 may already be generating
      this.logger.warn(`requestMp4Download ${uid} → ${res.status}`);
    }
  }

  async getMp4DownloadUrl(uid: string): Promise<string> {
    if (!this.isConfigured) return `dev://download/${uid}`;
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/stream/${uid}/downloads`,
      { headers: { Authorization: `Bearer ${this.apiToken}` } },
    );
    if (!res.ok) throw new Error(`Stream API error ${res.status}`);
    const data = (await res.json()) as {
      result?: { default?: { url?: string; status?: string } };
    };
    const url = data.result?.default?.url;
    if (!url) throw new Error(`MP4 for ${uid} not ready yet`);
    return url;
  }

  getPlaybackUrl(uid: string): string {
    const subdomain = this.config.get<string>('CF_STREAM_CUSTOMER_SUBDOMAIN') ?? '';
    if (!subdomain) return `dev://watch/${uid}`;
    return `https://customer-${subdomain}.cloudflarestream.com/${uid}/iframe`;
  }

  async deleteVideo(uid: string): Promise<void> {
    await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/stream/${uid}`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${this.apiToken}` },
      },
    );
  }
}
