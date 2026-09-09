import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { v2 as cloudinary, UploadApiResponse } from 'cloudinary';
import { APP_CONSTANTS } from 'src/common/constants';
import { Readable } from 'stream';

export function isSupportedImageBuffer(buffer: Buffer): boolean {
  if (!buffer || buffer.length < 12) return false;

  // JPG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return true;
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return true;
  }

  // GIF: GIF87a (47 49 46 38 37 61) hoặc GIF89a (47 49 46 38 39 61)
  if (
    buffer[0] === 0x47 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x38 &&
    (buffer[4] === 0x37 || buffer[4] === 0x39) &&
    buffer[5] === 0x61
  ) {
    return true;
  }

  // WEBP: RIFF ... WEBP
  if (
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return true;
  }

  // HEIC/HEIF: 4 byte đầu (độ dài), tiếp theo ftyp (66 74 79 70)
  if (
    buffer[4] === 0x66 &&
    buffer[5] === 0x74 &&
    buffer[6] === 0x79 &&
    buffer[7] === 0x70
  ) {
    const brand = buffer.subarray(8, 12).toString('ascii');
    if (['heic', 'heix', 'mif1', 'msf1'].includes(brand)) {
      return true;
    }
  }

  return false;
}

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

  private isOwnCloudinaryUrl(urlStr: string): boolean {
    try {
      const url = new URL(urlStr);
      const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
      return (
        url.hostname === 'res.cloudinary.com' &&
        url.pathname.includes(`/${cloudName}/`)
      );
    } catch {
      return false;
    }
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

    if (!isSupportedImageBuffer(file.buffer)) {
      throw new BadRequestException('Nội dung tập tin không phải là ảnh hợp lệ (fake MIME type)');
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

    if (input.startsWith('http://') || input.startsWith('https://')) {
      if (this.isOwnCloudinaryUrl(input)) {
        return input;
      }
      this.logger.warn(`Từ chối lưu URL không thuộc Cloudinary của dự án: ${input}`);
      return '';
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
        // Upload lỗi (mạng / Cloudinary lag) -> trả '' để caller lọc bỏ ảnh này, KHÔNG throw làm
        // hỏng cả request tạo/sửa yêu cầu. Chuỗi base64 KHÔNG được lưu xuống DB.
        this.logger.error(
          `Cloudinary Base64 upload lỗi, bỏ ảnh: ${err.message}`,
        );
        return '';
      }
    }

    // data: nhưng không phải ảnh (data:application/... v.v.) -> tuyệt đối KHÔNG để lọt vào DB.
    if (input.startsWith('data:')) return '';

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
