import { Module } from '@nestjs/common';
import { DatabaseBootstrapService } from './database-bootstrap.service';

@Module({
  providers: [DatabaseBootstrapService],
  exports: [DatabaseBootstrapService],
})
export class DatabaseModule {}
