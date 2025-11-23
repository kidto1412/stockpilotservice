import { Injectable, OnModuleInit } from '@nestjs/common';
import { readCsv } from 'src/utils/csv-reader';

@Injectable()
export class LocationService implements OnModuleInit {
  private provinces: any[] = [];
  private regencies: any[] = [];

  async onModuleInit() {
    this.provinces = await readCsv('provinces.csv');
    this.regencies = await readCsv('regencies.csv');
    console.log(readCsv);
    console.log('Loaded provinces:', this.provinces.length);
    console.log('Loaded regencies:', this.regencies.length);
  }

  getProvinces() {
    return this.provinces.map((p) => ({
      id: p.id,
      name: p.name,
    }));
  }

  getRegenciesByProvinceId(provinceId: string) {
    return this.regencies
      .filter((r) => r.provinceId === provinceId)
      .map((r) => ({
        id: r.id,
        name: r.name,
        provinceId: r.provinceId,
      }));
  }
}
