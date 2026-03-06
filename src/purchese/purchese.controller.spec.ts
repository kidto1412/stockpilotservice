import { Test, TestingModule } from '@nestjs/testing';
import { PurcheseController } from './purchese.controller';

describe('PurcheseController', () => {
  let controller: PurcheseController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PurcheseController],
    }).compile();

    controller = module.get<PurcheseController>(PurcheseController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
