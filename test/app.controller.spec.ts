import { Test, TestingModule } from '@nestjs/testing';
import { ServiceUnavailableException } from '@nestjs/common';
import { AppController } from '../src/app.controller';
import { AppService } from '../src/app.service';
import { PrismaService } from '../src/prisma/prisma.service';

describe('AppController', () => {
  let appController: AppController;
  let prisma: { $queryRaw: jest.Mock };

  beforeEach(async () => {
    prisma = { $queryRaw: jest.fn() };
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('trả chuỗi health-check mặc định', () => {
      expect(appController.getHello()).toBe('Hello World!');
    });
  });

  describe('health', () => {
    it('db lên -> { status: ok, db: up }', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([{ '?column?': 1 }]);
      await expect(appController.health()).resolves.toEqual({
        status: 'ok',
        db: 'up',
      });
    });

    it('db chết -> ServiceUnavailableException', async () => {
      prisma.$queryRaw.mockRejectedValueOnce(new Error('connection refused'));
      await expect(appController.health()).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    });
  });
});
