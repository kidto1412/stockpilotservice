// method di luar class dihapus
import { Controller, Get, Query, Param } from '@nestjs/common';
import {
  EventQueryDto,
  RecommendationListQueryDto,
  SyncStatusQueryDto,
  TechnicalQueryDto,
} from './dto/market-query.dto';
import { MarketService } from './market.service';

@Controller('market')
export class MarketController {
  constructor(private readonly marketService: MarketService) {}

  @Get('technical')
  getTechnical(@Query() query: TechnicalQueryDto) {
    return this.marketService.getTechnical(query);
  }

  @Get('events')
  getEvents(@Query() query: EventQueryDto) {
    return this.marketService.getEvents(query);
  }

  @Get('events/:id')
  getEventDetail(@Param('id') id: string) {
    return this.marketService.getEventDetail(Number(id));
  }

  @Get('sync-status')
  getSyncStatus(@Query() query: SyncStatusQueryDto) {
    return this.marketService.getSyncStatus(query);
  }

  @Get('recommendations')
  getRecommendations(@Query() query: RecommendationListQueryDto) {
    return this.marketService.getRecommendations(query);
  }
}
