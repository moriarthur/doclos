import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SearchService } from './search.service';
import { SearchController } from './search.controller';
import { Document } from '../documents/entities/document.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Document])],
  controllers: [SearchController],
  providers: [SearchService],
})
export class SearchModule {}
