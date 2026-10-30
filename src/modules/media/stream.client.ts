import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, createHmac } from 'crypto';

export interface TusHeaders {
  AuthorizationSignature: string;
  AuthorizationExpire: string;
  VideoId: string;
  LibraryId: string;
}

export interface IStreamClient {
  createTusUpload(params: {
    submissionId: string;
    uploadLength: number;
    maxDurationSec: number;
    expiryISO: string;
  }): Promise<{ tusUploadUrl: string; streamUid: string; tusHeaders: TusHeaders }>;
  requestMp4Download(uid: string): Promise<void>;
  getMp4DownloadUrl(uid: string): Promise<string>;
  getMediaUrls(uid: string, storedThumbnail?: string | null): Promise<{ playbackUrl: string; thumbnailUrl?: string }>;
  deleteVideo(uid: string): Promise<void>;
}

const BUNNY_API_BASE = 'https://video.bunnycdn.com';

@Injectable()
export class StreamClient implements IStreamClient {
  private readonly logger = new Logger(StreamClient.name);

  constructor(private readonly config: ConfigService) {}

  get isConfigured(): boolean {
    return !!(
      this.config.get<string>('BUNNY_LIBRARY_ID') &&
      this.config.get<string>('BUNNY_API_KEY')
    );
  }

  private get libraryId() {
    return this.config.get<string>('BUNNY_LIBRARY_ID')!;
  }
  private get apiKey() {
    return this.config.get<string>('BUNNY_API_KEY')!;
  }
  private get cdnHostname() {
    return this.config.get<string>('BUNNY_CDN_HOSTNAME') ?? '';
  }
  // Token key for CDN token authentication (set in pull zone settings)
  private get tokenKey() {
    return this.config.get<string>('BUNNY_TOKEN_KEY') ?? '';
  }
  private get requireSigned(): boolean {
    return !!this.tokenKey;
  }

  /**
   * Bunny CDN token authentication.
   * SHA256(tokenKey + path + expires) → base64url
   * https://support.bunny.net/hc/en-us/articles/360016055099
   */
  private cdnToken(path: string, expires: number): string {
    return createHash('sha256')
      .update(this.tokenKey + path + expires)
      .digest('base64url');
  }

  /**
   * Signed token for iframe embed.
   * SHA256(tokenKey + videoId + expires) → hex
   */
  private iframeToken(uid: string, expires: number): string {
    return createHash('sha256')
      .update(this.tokenKey + uid + expires)
      .digest('hex');
  }

  async createTusUpload(params: {
    submissionId: string;
    uploadLength: number;
    maxDurationSec: number;
    expiryISO: string;
  }): Promise<{ tusUploadUrl: string; streamUid: string }> {
    // Step 1: Create a video object to get the GUID
    const createRes = await fetch(`${BUNNY_API_BASE}/library/${this.libraryId}/videos`, {
      method: 'POST',
      headers: { AccessKey: this.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: params.submissionId }),
    });
    if (!createRes.ok) {
      throw new Error(`Bunny create video error ${createRes.status}: ${await createRes.text()}`);
    }
    const { guid: videoId } = (await createRes.json()) as { guid: string };

    // Step 2: Initiate TUS upload with HMAC-authenticated headers
    // Signature = SHA256(libraryId + apiKey + expiresAt + videoId)
    const expiresAt = Math.floor(new Date(params.expiryISO).getTime() / 1000);
    const signature = createHash('sha256')
      .update(this.libraryId + this.apiKey + expiresAt + videoId)
      .digest('hex');

    const b64 = (s: string) => Buffer.from(s).toString('base64');
    const metadata = [
      `filetype ${b64('video/mp4')}`,
      `title ${b64(params.submissionId)}`,
    ].join(',');

    const tusRes = await fetch(`${BUNNY_API_BASE}/tusupload`, {
      method: 'POST',
      headers: {
        AuthorizationSignature: signature,
        AuthorizationExpire: String(expiresAt),
        VideoId: videoId,
        LibraryId: this.libraryId,
        'Tus-Resumable': '1.0.0',
        'Upload-Length': String(params.uploadLength),
        'Upload-Metadata': metadata,
      },
    });
    if (!tusRes.ok) {
      throw new Error(`Bunny TUS initiate error ${tusRes.status}: ${await tusRes.text()}`);
    }

    const tusUploadUrl = tusRes.headers.get('location') ?? '';
    if (!tusUploadUrl) {
      throw new Error('Bunny TUS API did not return a location header');
    }

    return {
      tusUploadUrl,
      streamUid: videoId,
      tusHeaders: {
        AuthorizationSignature: signature,
        AuthorizationExpire: String(expiresAt),
        VideoId: videoId,
        LibraryId: this.libraryId,
      },
    };
  }

  // Bunny automatically transcodes all uploads — no explicit MP4 request needed.
  async requestMp4Download(_uid: string): Promise<void> {}

  async getMp4DownloadUrl(uid: string): Promise<string> {
    if (!this.isConfigured || !this.cdnHostname) return `dev://download/${uid}`;
    const path = `/${uid}/play_720p.mp4`;
    if (!this.requireSigned) {
      return `https://${this.cdnHostname}${path}`;
    }
    const expires = Math.floor(Date.now() / 1000) + 3600;
    const token = this.cdnToken(path, expires);
    return `https://${this.cdnHostname}${path}?token=${token}&expires=${expires}`;
  }

  async getMediaUrls(
    uid: string,
    storedThumbnail?: string | null,
  ): Promise<{ playbackUrl: string; thumbnailUrl?: string }> {
    if (!this.isConfigured) {
      return { playbackUrl: `dev://watch/${uid}`, thumbnailUrl: storedThumbnail ?? undefined };
    }

    const iframeBase = `https://iframe.mediadelivery.net/embed/${this.libraryId}/${uid}`;
    const thumbPath = `/${uid}/thumbnail.jpg`;

    if (!this.requireSigned) {
      return {
        playbackUrl: iframeBase,
        thumbnailUrl: this.cdnHostname
          ? `https://${this.cdnHostname}${thumbPath}`
          : (storedThumbnail ?? undefined),
      };
    }

    const expires = Math.floor(Date.now() / 1000) + 3600;
    const playbackUrl = `${iframeBase}?token=${this.iframeToken(uid, expires)}&expires=${expires}`;
    const thumbnailUrl = this.cdnHostname
      ? `https://${this.cdnHostname}${thumbPath}?token=${this.cdnToken(thumbPath, expires)}&expires=${expires}`
      : (storedThumbnail ?? undefined);

    return { playbackUrl, thumbnailUrl };
  }

  async deleteVideo(uid: string): Promise<void> {
    if (!this.isConfigured) return;
    const res = await fetch(`${BUNNY_API_BASE}/library/${this.libraryId}/videos/${uid}`, {
      method: 'DELETE',
      headers: { AccessKey: this.apiKey },
    });
    if (!res.ok && res.status !== 404) {
      this.logger.warn(`deleteVideo ${uid} failed: HTTP ${res.status}`);
    }
  }

  /**
   * Verifies a Bunny Stream webhook signature.
   * Bunny sends: Bunny-Signature: HMAC-SHA256(webhookSecret, rawBody) in hex.
   * https://docs.bunny.net/docs/stream-webhook
   */
  verifyWebhookSignature(rawBody: Buffer, signature: string | undefined, secret: string): void {
    const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
    if (!signature || signature.toLowerCase() !== expected) {
      throw new Error('BUNNY_SIGNATURE_INVALID');
    }
  }
}
