import {
  Body,
  Controller,
  Get,
  MessageEvent,
  Param,
  Post,
  Query,
  Sse,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { AppService } from './app.service';
import {
  AutoRecommendationRequestDto,
  StockAnalysisRequestDto,
  TrainMlModelRequestDto,
} from './app.dto';
import { Public } from './common/decorators/public.decorator';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Public()
  @Get()
  getInfo() {
    return this.appService.getInfo();
  }

  @Public()
  @Post('stock-analysis/recommendation')
  getStockRecommendation(@Body() payload: StockAnalysisRequestDto) {
    return this.appService.generateRecommendation(payload);
  }

  @Public()
  @Post('stock-analysis/recommendation/auto')
  getAutoRecommendation(@Body() payload: AutoRecommendationRequestDto) {
    return this.appService.generateAutoRecommendation(payload);
  }

  @Public()
  @Get('stock-analysis/market-data/:symbol')
  getMarketData(@Param('symbol') symbol: string) {
    return this.appService.getMarketData(symbol);
  }

  @Public()
  @Sse('stock-analysis/stream/:symbol')
  streamRealtimeRecommendation(
    @Param('symbol') symbol: string,
    @Query('intervalMs') intervalMs?: string,
    @Query('foreignFlowBillion') foreignFlowBillion?: string,
    @Query('brokerNetBuyTop3Billion') brokerNetBuyTop3Billion?: string,
    @Query('indicators') indicators?: string,
    @Query('style') style?: string,
  ): Observable<MessageEvent> {
    const parsedIndicators = indicators
      ? indicators
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean)
      : undefined;

    return this.appService.streamRealtimeRecommendation(symbol, {
      intervalMs: intervalMs ? Number(intervalMs) : undefined,
      foreignFlowBillion: foreignFlowBillion ? Number(foreignFlowBillion) : undefined,
      brokerNetBuyTop3Billion: brokerNetBuyTop3Billion
        ? Number(brokerNetBuyTop3Billion)
        : undefined,
      tradingViewIndicators: parsedIndicators,
      strategyStyle: style as any,
    });
  }

  @Public()
  @Post('stock-analysis/ml/train')
  trainMl(@Body() payload: TrainMlModelRequestDto) {
    return this.appService.trainMlModel(payload);
  }

  @Public()
  @Get('stock-analysis/tradingview/:symbol')
  getTradingViewConfig(
    @Param('symbol') symbol: string,
    @Query('indicators') indicators?: string,
  ) {
    const parsedIndicators = indicators
      ? indicators
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean)
      : undefined;

    return this.appService.getTradingViewConfig(symbol, parsedIndicators);
  }
}
