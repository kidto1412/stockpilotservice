import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('should return app metadata', () => {
      const result = appController.getInfo();
      expect(result.appName).toBe('StockPilot IDX Analyzer');
      expect(result.endpoints.recommendation).toBe(
        'POST /stock-analysis/recommendation',
      );
    });
  });
});
