import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { MaterialsService } from '../src/materials/materials.service';
import { PrismaService } from '../src/prisma/prisma.service';

describe('MaterialsService — remove', () => {
  let service: MaterialsService;
  let prisma: { material: { findUnique: jest.Mock; update: jest.Mock } };

  beforeEach(async () => {
    prisma = {
      material: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MaterialsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<MaterialsService>(MaterialsService);
  });

  it('throws NotFoundException khi không tìm thấy chất liệu', async () => {
    prisma.material.findUnique.mockResolvedValue(null);
    await expect(service.remove('id1')).rejects.toThrow(NotFoundException);
    expect(prisma.material.update).not.toHaveBeenCalled();
  });

  it('xóa mềm (isActive=false) khi tìm thấy chất liệu', async () => {
    prisma.material.findUnique.mockResolvedValue({ id: 'id1' });
    const result = await service.remove('id1');
    expect(prisma.material.update).toHaveBeenCalledWith({
      where: { id: 'id1' },
      data: { isActive: false },
    });
    expect(result).toEqual({ message: 'Đã xóa chất liệu thành công' });
  });
});
