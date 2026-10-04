import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { MediaType } from '@prisma/client';

const MAX_PHOTO_BYTES = 15 * 1024 * 1024; // 15 MB

export class UploadSubmissionDto {
  @IsEnum(MediaType)
  mediaType: MediaType;

  // Required for VIDEO
  @IsOptional()
  @IsInt()
  @Min(1)
  uploadLength?: number;

  // Required for PHOTO
  @IsOptional()
  @IsString()
  contentType?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_PHOTO_BYTES)
  size?: number;
}
