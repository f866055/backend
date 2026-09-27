import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        AppService,
        {
          provide: getDataSourceToken(),
          useValue: { query: jest.fn().mockResolvedValue([{ '?column?': 1 }]) },
        },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('should return "Hello World!"', () => {
      expect(appController.getHello()).toBe('Hello World!');
    });
  });

  describe('health', () => {
    it('reports ok when the database answers', async () => {
      await expect(appController.getHealth()).resolves.toEqual({
        status: 'ok',
        database: 'connected',
      });
    });

    it('reports degraded when the database fails', async () => {
      const app: TestingModule = await Test.createTestingModule({
        controllers: [AppController],
        providers: [
          AppService,
          {
            provide: getDataSourceToken(),
            useValue: {
              query: jest.fn().mockRejectedValue(new Error('sin conexión')),
            },
          },
        ],
      }).compile();

      const controller = app.get<AppController>(AppController);
      await expect(controller.getHealth()).resolves.toEqual({
        status: 'degraded',
        database: 'disconnected',
      });
    });
  });
});
