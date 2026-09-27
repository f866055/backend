import {
  Controller,
  Get,
  Post,
  UnsupportedMediaTypeException,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  UploadedFiles,
  Body,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { VisionService } from './vision.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { Express } from 'express';

// Las imágenes se procesan en memoria (sharp + Tesseract), así que el tamaño
// debe estar acotado o un archivo grande tumba el contenedor.
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_FRAMES = 4;
const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/bmp',
  'image/tiff',
]);

const uploadOptions = {
  limits: { fileSize: MAX_IMAGE_BYTES, files: MAX_FRAMES },
  fileFilter: (
    _req: unknown,
    file: Express.Multer.File,
    callback: (error: Error | null, acceptFile: boolean) => void,
  ) => {
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      return callback(
        new UnsupportedMediaTypeException(
          `Formato no permitido: ${file.mimetype}. Usa JPEG, PNG, WEBP, BMP o TIFF.`,
        ),
        false,
      );
    }
    callback(null, true);
  },
};

@UseGuards(JwtAuthGuard)
@Controller('vision')
export class VisionController {
  constructor(private readonly visionService: VisionService) {}

  @Get('health')
  getHealth() {
    return {
      status: this.visionService.isOcrReady ? 'ready' : 'initializing',
      detector: true,
      ocr: this.visionService.isOcrReady,
    };
  }

  @Post('read-plate')
  @UseInterceptors(FileInterceptor('file', uploadOptions))
  async readPlate(
    @UploadedFile() file: Express.Multer.File,
    @Body('bbox') bbox?: string,
  ) {
    if (!file) {
      throw new HttpException(
        'No se recibió la imagen',
        HttpStatus.BAD_REQUEST,
      );
    }
    return this.visionService.readPlate(file.buffer, file.originalname, bbox);
  }

  @Post('read-frames')
  @UseInterceptors(FilesInterceptor('files', MAX_FRAMES, uploadOptions))
  async readFrames(@UploadedFiles() files: Array<Express.Multer.File>) {
    if (!files || files.length === 0) {
      throw new HttpException(
        'No se recibieron las imágenes',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (files.length === 1) {
      return this.visionService.readPlate(
        files[0].buffer,
        files[0].originalname,
      );
    }

    return this.visionService.readFrames(files.map((f) => f.buffer));
  }
}
