import { Test, TestingModule } from '@nestjs/testing';
import { BusinessTypeController } from './business-type.controller';

describe('BusinessTypeController', () => {
  let controller: BusinessTypeController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [BusinessTypeController],
    }).compile();

    controller = module.get<BusinessTypeController>(BusinessTypeController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
