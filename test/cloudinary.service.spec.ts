import { isSupportedImageBuffer } from '../src/cloudinary/cloudinary.service';

describe('isSupportedImageBuffer', () => {
  it('should accept valid JPG buffer', () => {
    const buffer = Buffer.from('ffd8ffe000104a4649460001', 'hex');
    expect(isSupportedImageBuffer(buffer)).toBe(true);
  });

  it('should accept valid PNG buffer', () => {
    const buffer = Buffer.from('89504e470d0a1a0a0000000d', 'hex');
    expect(isSupportedImageBuffer(buffer)).toBe(true);
  });

  it('should accept valid GIF87a buffer', () => {
    const buffer = Buffer.from('474946383761010001000000', 'hex');
    expect(isSupportedImageBuffer(buffer)).toBe(true);
  });

  it('should accept valid GIF89a buffer', () => {
    const buffer = Buffer.from('474946383961010001000000', 'hex');
    expect(isSupportedImageBuffer(buffer)).toBe(true);
  });

  it('should accept valid WEBP buffer', () => {
    // RIFF ... WEBP
    const buffer = Buffer.concat([
      Buffer.from('52494646', 'hex'), // RIFF
      Buffer.from('00000000', 'hex'), // length
      Buffer.from('57454250', 'hex'), // WEBP
    ]);
    expect(isSupportedImageBuffer(buffer)).toBe(true);
  });

  it('should accept valid HEIC buffer', () => {
    // length (4) + ftyp (4) + heic (4)
    const buffer = Buffer.concat([
      Buffer.from('00000020', 'hex'), // length
      Buffer.from('66747970', 'hex'), // ftyp
      Buffer.from('68656963', 'hex'), // heic
    ]);
    expect(isSupportedImageBuffer(buffer)).toBe(true);
  });

  it('should accept valid HEIX buffer', () => {
    const buffer = Buffer.concat([
      Buffer.from('00000020', 'hex'), // length
      Buffer.from('66747970', 'hex'), // ftyp
      Buffer.from('68656978', 'hex'), // heix
    ]);
    expect(isSupportedImageBuffer(buffer)).toBe(true);
  });

  it('should reject empty buffer', () => {
    expect(isSupportedImageBuffer(Buffer.from(''))).toBe(false);
  });

  it('should reject short buffer', () => {
    expect(isSupportedImageBuffer(Buffer.from('89504e470d0a1a', 'hex'))).toBe(false);
  });

  it('should reject fake MIME (text file)', () => {
    const buffer = Buffer.from('Hello world! This is a text file that was renamed to .png', 'utf-8');
    expect(isSupportedImageBuffer(buffer)).toBe(false);
  });

  it('should reject random binary data', () => {
    const buffer = Buffer.from('00112233445566778899aabbccddeeff', 'hex');
    expect(isSupportedImageBuffer(buffer)).toBe(false);
  });
});
