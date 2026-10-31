import { Injectable } from '@nestjs/common';
import { mkdir, open, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { isUUID } from 'class-validator';

@Injectable()
export class FileStorage {
  private root() {
    const value = process.env.ATTACHMENT_STORAGE_DIR;
    if (!value || !isAbsolute(value))
      throw new Error('ATTACHMENT_STORAGE_DIR absolu requis.');
    return resolve(value);
  }
  private path(key: string) {
    if (!isUUID(key)) throw new Error('Invalid storage identifier');
    return join(this.root(), key);
  }
  async write(key: string, data: Buffer) {
    await mkdir(this.root(), { recursive: true, mode: 0o700 });
    const handle = await open(this.path(key), 'wx', 0o600);
    try {
      await handle.writeFile(data);
      await handle.sync();
    } catch (error) {
      await handle.close();
      await this.remove(key);
      throw error;
    }
    await handle.close();
  }
  async remove(key: string) {
    await unlink(this.path(key));
  }
  async read(key: string) {
    // Reject symbolic links and non-regular files; never resolve a client path.
    const handle = await open(
      this.path(key),
      constants.O_RDONLY | (constants.O_NOFOLLOW || 0),
    );
    try {
      const stat = await handle.stat();
      if (!stat.isFile()) throw new Error('Not a regular file');
      return await handle.readFile();
    } finally {
      await handle.close();
    }
  }
}
