import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class HealthService {
  constructor(private readonly prisma: PrismaService) {}

  async check() {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.prisma.$queryRaw`SELECT 1`,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error('Database timeout')), 3000);
        }),
      ]);
      return { status: 'ok', database: 'up' };
    } catch {
      throw new ServiceUnavailableException({
        status: 'error',
        database: 'down',
      });
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
