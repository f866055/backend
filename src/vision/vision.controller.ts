import {
  Controller,
  Get,
  Post,
  UseInterceptors,
  UploadedFile,
  UploadedFiles,
  Body,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { VisionService } from './vision.service';
import type { Express } from 'express';

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
  @UseInterceptors(FileInterceptor('file'))
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
  @UseInterceptors(FilesInterceptor('files'))
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
