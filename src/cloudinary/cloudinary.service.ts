import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { v2 as cloudinary, UploadApiResponse } from 'cloudinary';
import { APP_CONSTANTS } from 'src/common/constants';
import { Readable } from 'stream';

@Injectable()
export class CloudinaryService {
  private readonly logger = new Logger(CloudinaryService.name);

  constructor() {
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    const apiKey = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;

    cloudinary.config({
      cloud_name: cloudName,
      api_key: apiKey,
      api_secret: apiSecret,
      secure: true,
    });

    this.logger.log(`☁️ Cloudinary initialized with Cloud Name: ${cloudName}`);
  }

  /**
   * Upload tập tin thô (Express.Multer.File) lên Cloudinary
   * Backend xử lý & validate 100%
   */
  async uploadImage(
    file: Express.Multer.File,
  ): Promise<{ url: string; publicId: string }> {
    if (!file || !file.buffer) {
      throw new BadRequestException('Vui lòng chọn tập tin ảnh để tải lên');
    }

    // 1. Validate File Size (Tối đa 10MB)
    const maxSizeBytes = APP_CONSTANTS.MAX_FILE_SIZE; // 10MB
    if (file.size > maxSizeBytes) {
      throw new BadRequestException(
        'Kích thước tập tin ảnh vượt quá giới hạn cho phép (tối đa 10MB)',
      );
    }

    // 2. Validate MIME Type
    const allowedMimeTypes = APP_CONSTANTS.ALLOWED_MIME_TYPES;
    if (!allowedMimeTypes.includes(file.mimetype.toLowerCase())) {
      throw new BadRequestException(
        `Định dạng tệp ${file.mimetype} không được hỗ trợ. Vui lòng chỉ tải lên tập tin ảnh (PNG, JPG, WEBP, GIF, HEIC)`,
      );
    }

    // 3. Upload Stream lên Cloudinary
    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder: 'vcb-qms-quotes',
          resource_type: 'image',
        },
        (error: any, result?: UploadApiResponse) => {
          if (error || !result) {
            this.logger.error(
              `Cloudinary Upload Error: ${JSON.stringify(error)}`,
            );
            return reject(
              new BadRequestException(
                `Không thể tải ảnh lên Cloudinary: ${error?.message || 'Lỗi mạng'}`,
              ),
            );
          }

          this.logger.log(
            `Uploaded to Cloudinary successfully: ${result.secure_url}`,
          );
          resolve({
            url: result.secure_url,
            publicId: result.public_id,
          });
        },
      );

      const stream = new Readable();
      stream.push(file.buffer);
      stream.push(null);
      stream.pipe(uploadStream);
    });
  }

  /**
   * Upload chuỗi ảnh (Base64 hoặc URL) lên Cloudinary
   * Nếu đã là HTTPS Cloudinary URL thì giữ nguyên, nếu là Base64/DataURL thì đẩy lên Cloudinary
   */
  async uploadBase64OrUrl(input: string): Promise<string> {
    if (!input || typeof input !== 'string') return '';

    // Nếu đã là Cloudinary URL hoặc HTTP URL hợp lệ
    if (input.startsWith('http://') || input.startsWith('https://')) {
      return input;
    }

    // Nếu là Data URL Base64
    if (input.startsWith('data:image')) {
      try {
        const result = await cloudinary.uploader.upload(input, {
          folder: 'vcb-qms-quotes',
          resource_type: 'image',
        });
        this.logger.log(`Base64 Uploaded to Cloudinary: ${result.secure_url}`);
        return result.secure_url;
      } catch (err: any) {
        this.logger.error(`Cloudinary Upload Error: ${err.message}`);
        throw new BadRequestException(
          `Không thể tải ảnh Base64 lên Cloudinary: ${err.message}`,
        );
      }
    }

    return input;
  }

  /**
   * Upload video (Express.Multer.File) lên Cloudinary — resource_type: video
   */
  async uploadVideo(
    file: Express.Multer.File,
  ): Promise<{ url: string; publicId: string }> {
    if (!file || !file.buffer) {
      throw new BadRequestException('Vui lòng chọn tập tin video để tải lên');
    }

    const maxSizeBytes = APP_CONSTANTS.MAX_VIDEO_FILE_SIZE;
    if (file.size > maxSizeBytes) {
      throw new BadRequestException(
        'Kích thước video vượt quá giới hạn cho phép (tối đa 100MB)',
      );
    }

    const allowedMimeTypes = APP_CONSTANTS.ALLOWED_VIDEO_MIME_TYPES;
    if (!allowedMimeTypes.includes(file.mimetype.toLowerCase())) {
      throw new BadRequestException(
        `Định dạng tệp ${file.mimetype} không được hỗ trợ. Vui lòng chỉ tải lên tập tin video (MP4, MOV, WEBM)`,
      );
    }

    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder: 'vcb-qms-quotes',
          resource_type: 'video',
        },
        (error: any, result?: UploadApiResponse) => {
          if (error || !result) {
            this.logger.error(
              `Cloudinary Video Upload Error: ${JSON.stringify(error)}`,
            );
            return reject(
              new BadRequestException(
                `Không thể tải video lên Cloudinary: ${error?.message || 'Lỗi mạng'}`,
              ),
            );
          }

          this.logger.log(
            `Video Uploaded to Cloudinary successfully: ${result.secure_url}`,
          );
          resolve({
            url: result.secure_url,
            publicId: result.public_id,
          });
        },
      );

      const stream = new Readable();
      stream.push(file.buffer);
      stream.push(null);
      stream.pipe(uploadStream);
    });
  }

  /**
   * Upload danh sách nhiều ảnh cùng lúc
   */
  async uploadMultipleImages(
    files: Express.Multer.File[],
  ): Promise<{ url: string; publicId: string }[]> {
    if (!files || files.length === 0) {
      return [];
    }
    if (files.length > 5) {
      throw new BadRequestException(
        'Chỉ được phép tải lên tối đa 5 ảnh cùng lúc',
      );
    }

    const uploadPromises = files.map((file) => this.uploadImage(file));
    return Promise.all(uploadPromises);
  }
}
