import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { SearchService } from './search.service';
import { SearchQueryDto } from './search.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../auth/entities/user.entity';

// GET /api/v1/search — server-side full-text search.
@Controller('search')
@UseGuards(JwtAuthGuard)
export class SearchController {
  constructor(private searchService: SearchService) {}

  @Get()
  async search(@CurrentUser() user: User, @Query() query: SearchQueryDto) {
    return this.searchService.searchDocuments(user.id, query);
  }
}
