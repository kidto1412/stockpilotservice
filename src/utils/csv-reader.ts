import * as fs from 'fs';
import * as path from 'path';
import * as csv from 'csv-parser';

export async function readCsv(fileName: string): Promise<any[]> {
  const filePath = path.join(process.cwd(), 'src/data', fileName);
  const results: any[] = [];

  const headers =
    fileName === 'provinces.csv'
      ? ['id', 'name']
      : fileName === 'regencies.csv'
        ? ['id', 'provinceId', 'name']
        : undefined;

  return new Promise((resolve, reject) => {
    fs.createReadStream(filePath)
      .pipe(csv({ headers, skipLines: 0 }))
      .on('data', (data) => results.push(data))
      .on('end', () => resolve(results))
      .on('error', reject);
  });
}
