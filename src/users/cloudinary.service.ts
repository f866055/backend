import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  v2 as cloudinary,
  UploadApiResponse,
  UploadApiErrorResponse,
} from 'cloudinary';
import sharp from 'sharp';

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'error desconocido';
}

@Injectable()
export class CloudinaryService {
  private readonly logger = new Logger(CloudinaryService.name);
  private isConfigured = false;

  constructor(private readonly configService: ConfigService) {
    const cloudName = this.configService
      .get<string>('CLOUDINARY_CLOUD_NAME')
      ?.trim();
    const apiKey = this.configService.get<string>('CLOUDINARY_API_KEY')?.trim();
    const apiSecret = this.configService
      .get<string>('CLOUDINARY_API_SECRET')
      ?.trim();

    if (cloudName && apiKey && apiSecret) {
      cloudinary.config({
        cloud_name: cloudName,
        api_key: apiKey,
        api_secret: apiSecret,
      });
      this.isConfigured = true;
      this.logger.log(`Cloudinary configurado para cloud: ${cloudName}`);
    } else {
      this.logger.warn(
        'Credenciales de Cloudinary incompletas en .env. Se usará almacenamiento optimizado local/Base64.',
      );
    }
  }

  async uploadAvatar(
    file: Express.Multer.File,
  ): Promise<{ url: string; publicId: string }> {
    // 1. Optimizar siempre la imagen con sharp (400x400, rotación EXIF correcta, WebP, calidad 85)
    let optimizedBuffer: Buffer;
    let mimeType = 'image/webp';

    try {
      optimizedBuffer = await sharp(file.buffer)
        .rotate() // Corrige orientación de fotos tomadas con teléfonos móviles
        .resize(400, 400, { fit: 'cover', position: 'center' })
        .webp({ quality: 85 })
        .toBuffer();
    } catch (sharpError: unknown) {
      this.logger.warn(
        `No se pudo procesar con sharp (${errorMessage(sharpError)}), usando buffer original.`,
      );
      optimizedBuffer = file.buffer;
      mimeType = file.mimetype || 'image/jpeg';
    }

    // 2. Si Cloudinary está configurado, intentar subirlo
    if (this.isConfigured) {
      try {
        const cloudinaryResult = await this.uploadToCloudinary(optimizedBuffer);
        this.logger.log(
          `Avatar subido exitosamente a Cloudinary: ${cloudinaryResult.url}`,
        );
        return cloudinaryResult;
      } catch (cloudinaryError: unknown) {
        const message = errorMessage(cloudinaryError);
        this.logger.warn(
          `Fallo al subir a Cloudinary (${message}). Activando fallback de almacenamiento optimizado.`,
        );
        // Si las credenciales son inválidas (401 / unknown api_key), desactivar Cloudinary para evitar demoras
        const httpCode = (cloudinaryError as { http_code?: number })?.http_code;
        if (httpCode === 401 || message.toLowerCase().includes('api_key')) {
          this.isConfigured = false;
        }
      }
    }

    // 3. Fallback infalible de alta fidelidad: Data URI WebP ultracompacto (~15-25 KB)
    // Funciona instantáneamente en cualquier cliente (PC, Wi-Fi LAN móvil, APK Android, túneles)
    const base64Data = optimizedBuffer.toString('base64');
    const dataUrl = `data:${mimeType};base64,${base64Data}`;
    this.logger.log(
      `Avatar guardado exitosamente con almacenamiento optimizado (${Math.round(optimizedBuffer.length / 1024)} KB).`,
    );

    return {
      url: dataUrl,
      publicId: '',
    };
  }

  private uploadToCloudinary(
    buffer: Buffer,
  ): Promise<{ url: string; publicId: string }> {
    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder: 'garagepro/avatars',
          resource_type: 'image',
          transformation: [
            { width: 400, height: 400, crop: 'fill', gravity: 'face' },
            { quality: 'auto', fetch_format: 'auto' },
          ],
        },
        (
          error: UploadApiErrorResponse | undefined,
          result: UploadApiResponse | undefined,
        ) => {
          if (error) {
            const failure: Error =
              error instanceof Error
                ? error
                : new Error(
                    typeof error.message === 'string' && error.message
                      ? error.message
                      : 'Error de Cloudinary',
                  );
            return reject(failure);
          }
          if (!result) {
            return reject(new Error('Respuesta vacía de Cloudinary'));
          }
          resolve({
            url: result.secure_url,
            publicId: result.public_id,
          });
        },
      );

      uploadStream.end(buffer);
    });
  }

  async deleteAvatar(publicId: string): Promise<void> {
    if (!this.isConfigured || !publicId) return;
    try {
      await cloudinary.uploader.destroy(publicId);
    } catch (err: unknown) {
      this.logger.warn(
        `No se pudo eliminar el avatar anterior en Cloudinary (${publicId}): ${errorMessage(err)}`,
      );
    }
  }
}
