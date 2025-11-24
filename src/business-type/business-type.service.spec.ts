import { Test, TestingModule } from '@nestjs/testing';
import { BusinessTypeService } from './business-type.service';

describe('BusinessTypeService', () => {
  let service: BusinessTypeService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [BusinessTypeService],
    }).compile();

    service = module.get<BusinessTypeService>(BusinessTypeService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
