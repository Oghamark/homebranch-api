import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { IStorageService } from './storage.interface';
import {
  StorageUploadOptions,
  StorageUploadResult,
  StorageStreamResult,
  StorageFileItem,
  FileBufferResult,
  StorageFileStats,
  StorageByteRange,
} from './storage.types';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  HeadObjectCommand,
  CopyObjectCommand,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { ConfigService } from '@nestjs/config';
import { EnvironmentVariables } from 'src/common/types/env.interface';
import { Readable } from 'stream';
import { createReadStream } from 'fs-extra';
import { statSync } from 'node:fs';

@Injectable()
export class R2Storage implements IStorageService {
  private readonly logger = new Logger(R2Storage.name);
  private readonly s3: S3Client;
  private readonly bucket: string;
  private readonly appUrl: string;

  constructor(private readonly configService: ConfigService<EnvironmentVariables>) {
    this.bucket = this.configService.getOrThrow('R2_BUCKET');
    this.appUrl = this.configService.getOrThrow('APP_URL');

    const r2AccountId: string = this.configService.getOrThrow('R2_ACCOUNT_ID');
    const r2AccessKeyId: string = this.configService.getOrThrow('R2_ACCESS_KEY_ID');
    const r2SecretAccessKey: string = this.configService.getOrThrow('R2_SECRET_ACCESS_KEY');

    const jurisdiction = this.configService.get('R2_JURISDICTION');
    const host = jurisdiction
      ? `${r2AccountId}.${jurisdiction}.r2.cloudflarestorage.com`
      : `${r2AccountId}.r2.cloudflarestorage.com`;

    try {
      this.s3 = new S3Client({
        region: 'auto',
        endpoint: `https://${host}`,
        credentials: {
          accessKeyId: r2AccessKeyId,
          secretAccessKey: r2SecretAccessKey,
        },
      });
    } catch (error) {
      this.logger.error('Failed to create S3 client', error);
      throw error;
    }
  }

  async uploadFile(fileBuffer: Buffer, options: StorageUploadOptions): Promise<StorageUploadResult> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: options.key,
      Body: fileBuffer,
      ContentType: options.mimeType,
    });
    await this.s3.send(command);
    return {
      key: options.key,
      url: `${this.appUrl}/uploads/${options.key}`,
    };
  }

  async uploadFileFromPath(filePath: string, options: StorageUploadOptions): Promise<StorageUploadResult> {
    const fileStream = createReadStream(filePath);
    const fileStats = statSync(filePath);
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: options.key,
      Body: fileStream,
      ContentType: options.mimeType,
      ContentLength: fileStats.size,
    });
    await this.s3.send(command);
    return {
      key: options.key,
      url: `${this.appUrl}/uploads/${options.key}`,
    };
  }

  async moveFile(key: string, destinationKey: string): Promise<void> {
    const copyCommand = new CopyObjectCommand({
      Bucket: this.bucket,
      CopySource: `${this.bucket}/${key}`,
      Key: destinationKey,
    });
    await this.s3.send(copyCommand);

    const deleteCommand = new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });
    await this.s3.send(deleteCommand);
  }

  async getFileStream(key: string, range?: StorageByteRange): Promise<StorageStreamResult> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ...(range ? { Range: `bytes=${range.start}-${range.end}` } : {}),
    });
    const response = await this.s3.send(command);

    if (!response.Body) {
      throw new NotFoundException('File stream not found');
    }

    return {
      stream: response.Body as Readable,
      mimeType: response.ContentType ?? 'application/octet-stream',
      size: range
        ? Number(response.ContentRange?.split('/').at(-1) ?? response.ContentLength ?? 0)
        : (response.ContentLength ?? 0),
      contentRange: response.ContentRange,
    };
  }

  async getDownloadUrl(key: string, expiresIn = 3600): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });
    return getSignedUrl(this.s3, command, { expiresIn });
  }

  async deleteFile(key: string): Promise<void> {
    const command = new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });
    await this.s3.send(command);
  }

  async exists(key: string): Promise<boolean> {
    try {
      const command = new HeadObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });
      await this.s3.send(command);
      return true;
    } catch (error) {
      if (error instanceof S3ServiceException) {
        if (error.name === 'NotFound') {
          return false;
        }
      }
      this.logger.error('Failed to check if file exists', error);
      throw error;
    }
  }

  async listFiles(prefix = '', recursive = false): Promise<StorageFileItem[]> {
    const items: StorageFileItem[] = [];
    let continuationToken: string | undefined;

    do {
      const command = new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: prefix,
        Delimiter: recursive ? undefined : '/',
        ContinuationToken: continuationToken,
      });
      const response = await this.s3.send(command);

      items.push(
        ...(response.Contents ?? []).map((item) => ({
          key: item.Key ?? 'Unknown',
          fileName: item.Key?.split('/').pop() ?? 'Unknown',
          size: item.Size ?? 0,
          updatedAt: item.LastModified ?? new Date(),
        })),
      );
      continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
    } while (continuationToken);

    return items;
  }

  async getFileBuffer(key: string): Promise<FileBufferResult> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });
    const response = await this.s3.send(command);

    if (!response.Body) {
      throw new NotFoundException('File buffer not found');
    }

    const buffer = await response.Body.transformToByteArray();
    return {
      key,
      buffer: Buffer.from(buffer),
    };
  }

  async getFileStats(key: string): Promise<StorageFileStats> {
    try {
      const command = new HeadObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });
      const response = await this.s3.send(command);

      if (!response.LastModified) {
        throw new NotFoundException('File stats not found');
      }

      return {
        size: response.ContentLength ?? 0,
        mtimeMs: response.LastModified.getTime(),
        etag: response.ETag,
      };
    } catch (error) {
      if (error instanceof S3ServiceException && error.name === 'NotFound') {
        throw new NotFoundException('File not found');
      }
      throw error;
    }
  }
}
