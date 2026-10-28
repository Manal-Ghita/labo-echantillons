import { Injectable } from '@nestjs/common';
import { compare, hash } from 'bcryptjs';

@Injectable()
export class PasswordService {
  hash(password: string): Promise<string> {
    return hash(password, 12);
  }

  async verify(password: string, passwordHash: string): Promise<boolean> {
    if (Buffer.byteLength(password, 'utf8') > 72) return false;
    return compare(password, passwordHash);
  }
}
