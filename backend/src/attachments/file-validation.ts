import {
  BadRequestException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { extname } from 'node:path';

export type IncomingFile = {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
  size: number;
};

// Browsers send UTF-8 filename bytes, while the multipart parser defaults to
// latin1 for legacy filename headers. Decode valid UTF-8 without replacing
// invalid bytes in filenames sent by legacy clients.
export function multipartFilename(value: string): string {
  if (!Array.from(value).every((c) => c.charCodeAt(0) <= 255)) return value;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(
      Buffer.from(value, 'latin1'),
    );
  } catch {
    return value;
  }
}

export function maximumFileBytes(): number {
  const value = process.env.ATTACHMENT_MAX_BYTES ?? '10485760';
  if (
    !/^\d+$/.test(value) ||
    !Number.isSafeInteger(+value) ||
    +value < 1 ||
    +value > 104857600
  )
    throw new Error(
      'ATTACHMENT_MAX_BYTES doit être compris entre 1 et 104857600.',
    );
  return +value;
}

export function validateFile(file: IncomingFile | undefined) {
  if (!file || !Buffer.isBuffer(file.buffer))
    throw new BadRequestException('Un fichier est requis.');
  if (!file.buffer.length || file.size !== file.buffer.length)
    throw new BadRequestException('Fichier vide ou taille incohérente.');
  if (file.size > maximumFileBytes())
    throw new PayloadTooLargeException(
      'Le fichier dépasse la taille maximale autorisée.',
    );
  const originalName = file.originalname.normalize('NFC');
  if (
    !originalName.trim() ||
    originalName.length > 255 ||
    // Control characters and separators cannot be safe download filenames.
    // eslint-disable-next-line no-control-regex
    /[/\\\x00-\x1f\x7f]/.test(originalName) ||
    originalName === '.' ||
    originalName === '..'
  )
    throw new BadRequestException(
      'Nom de fichier non valide (255 caractères maximum, sans chemin).',
    );
  const extension = extname(originalName).toLowerCase();
  const data = file.buffer;
  let mimeType: string;
  if (
    ['.jpg', '.jpeg'].includes(extension) &&
    data.length >= 4 &&
    data.subarray(0, 3).equals(Buffer.from([255, 216, 255])) &&
    data.subarray(-2).equals(Buffer.from([255, 217]))
  )
    mimeType = 'image/jpeg';
  else if (
    extension === '.png' &&
    data.length >= 33 &&
    data
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
    data.toString('ascii', 12, 16) === 'IHDR'
  )
    mimeType = 'image/png';
  else if (
    extension === '.pdf' &&
    /^%PDF-1\.[0-9]|^%PDF-2\.0/.test(data.toString('ascii', 0, 8)) &&
    data.subarray(-1024).includes(Buffer.from('%%EOF'))
  )
    mimeType = 'application/pdf';
  else if (extension === '.csv') {
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(data);
    } catch {
      throw new UnsupportedMediaTypeException(
        'Le CSV doit être encodé en UTF-8.',
      );
    }
    // CSV accepts tabs/newlines, never NUL or binary control characters.
    // eslint-disable-next-line no-control-regex
    if (!text.trim() || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text))
      throw new UnsupportedMediaTypeException('Contenu CSV non valide.');
    mimeType = 'text/csv';
  } else
    throw new UnsupportedMediaTypeException(
      'Formats acceptés : JPEG, PNG, PDF et CSV UTF-8. Le contenu doit correspondre à l’extension.',
    );
  const declared = file.mimetype.toLowerCase();
  if (
    declared &&
    declared !== mimeType &&
    declared !== 'application/octet-stream' &&
    !(
      mimeType === 'text/csv' &&
      ['text/plain', 'application/vnd.ms-excel'].includes(declared)
    )
  )
    throw new UnsupportedMediaTypeException(
      'Le type déclaré ne correspond pas au contenu.',
    );
  return { originalName, mimeType, size: data.length };
}
