import { IsEnum, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { MediaType } from '@prisma/client';

export const MAX_PHOTO_BYTES = 15 * 1024 * 1024; // 15 MB
export const MAX_VIDEO_BYTES = 500 * 1024 * 1024; // 500 MB (≈ 60 s em 4K)
export const ALLOWED_PHOTO_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/heic', 'image/webp'];

export class UploadSubmissionDto {
  @IsEnum(MediaType)
  mediaType: MediaType;

  // Required for VIDEO
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_VIDEO_BYTES)
  uploadLength?: number;

  // Required for PHOTO
  @IsOptional()
  @IsIn(ALLOWED_PHOTO_CONTENT_TYPES)
  contentType?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_PHOTO_BYTES)
  size?: number;
}
