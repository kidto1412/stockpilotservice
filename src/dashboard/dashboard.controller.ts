import { Controller, Get, Query } from '@nestjs/common';
import { StoreId } from 'src/common/decorators/user.decorator';
import { DashboardService } from './dashboard.service';
import { DashboardSummaryQueryDto } from './dto/dashboard-summary.dto';

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('summary')
  getSummary(
    @StoreId() storeId: string,
    @Query() query: DashboardSummaryQueryDto,
  ) {
    return this.dashboardService.getSummary(storeId, query);
  }
}
