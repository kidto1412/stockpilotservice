import { Controller, Get, Param } from '@nestjs/common';
import { LocationService } from './location.service';

@Controller('locations')
export class LocationController {
  constructor(private readonly locationService: LocationService) {}
  @Get('provinces')
  getProvinces() {
    return this.locationService.getProvinces();
  }

  @Get('provinces/:provinceId/regencies')
  getRegenciesByProvince(@Param('provinceId') provinceId: string) {
    return this.locationService.getRegenciesByProvinceId(provinceId);
  }
}
